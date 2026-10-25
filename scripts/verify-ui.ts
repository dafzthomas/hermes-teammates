import { chromium, _electron, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { snapshotSchema } from '../src/domain';

const artifacts = path.resolve('test-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-ui-'));
const interactiveIssued = new Set<string>();
const fixture = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  if (!raw || !req.url?.includes('chat/completions')) {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  const body = JSON.parse(raw);
  const history = JSON.stringify(body.messages);
  const toolNames: string[] = (body.tools || []).map(
    (t: { function: { name: string } }) => t.function.name,
  );
  let tool: { name: string; arguments: string } | undefined;
  for (const marker of [
    'UI_QUESTION_PROOF',
    'UI_APPROVAL_PROOF',
    'UI_STOP_PROOF',
    'UI_LEGACY_QUESTION_PROOF',
    'UI_DESKTOP_QUESTION_PROOF',
    'UI_PROACTIVE_QUESTION_PROOF',
  ]) {
    if (!history.includes(marker) || interactiveIssued.has(marker)) continue;
    if (marker === 'UI_PROACTIVE_QUESTION_PROOF' && !history.includes('[Cronjob ')) continue;
    const name = marker === 'UI_APPROVAL_PROOF' ? 'terminal' : 'clarify';
    if (!toolNames.includes(name)) continue;
    interactiveIssued.add(marker);
    tool = {
      name,
      arguments: JSON.stringify(
        name === 'terminal'
          ? { command: 'rm -rf approval-target' }
          : { question: 'Which launch color should I use?', choices: ['Green', 'Blue'] },
      ),
    };
    break;
  }
  if (!tool && history.includes('[Cronjob ') && history.includes('UI_PROACTIVE_QUESTION_PROOF'))
    await new Promise((resolve) => setTimeout(resolve, 1500));
  const content =
    'I reviewed the launch brief. The next step is to confirm the sources and prepare a concise draft for review.';
  res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
  const message = tool
    ? {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `ui_tool_${interactiveIssued.size}`, type: 'function', function: tool }],
      }
    : { role: 'assistant', content };
  if (body.stream)
    res.end(
      `data: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', model: 'ui-fixture', choices: [{ index: 0, delta: tool ? { ...message, tool_calls: message.tool_calls?.map((call, index) => ({ index, ...call })) } : message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'ui-fixture', object: 'chat.completion.chunk', model: 'ui-fixture', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    );
  else
    res.end(
      JSON.stringify({
        id: 'ui-fixture',
        object: 'chat.completion',
        model: 'ui-fixture',
        choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      }),
    );
});
fixture.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => fixture.once('listening', resolve));
const endpoint = fixture.address();
if (!endpoint || typeof endpoint === 'string') throw new Error('Fixture address missing');
const probe = http.createServer();
probe.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => probe.once('listening', resolve));
const address = probe.address();
if (!address || typeof address === 'string') throw new Error('Port missing');
await new Promise<void>((resolve) => probe.close(() => resolve()));
const backend = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, TEAMMATES_DATA_DIR: data, PORT: String(address.port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
backend.stderr.resume();
async function stopBackend() {
  if (backend.exitCode !== null || backend.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    backend.once('exit', () => resolve());
    backend.kill('SIGTERM');
  });
}
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 20000);
  backend.stdout.on('data', (data) => {
    if (String(data).includes('listening on')) {
      clearTimeout(timer);
      resolve();
    }
  });
  backend.on('error', reject);
});
const appUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByText('Meet Hermes.', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Show Bot details', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('.details-panel')).toHaveCount(0);
  expect(
    (await page.locator('.chat-header, .composer-area, .sidebar').allInnerTexts()).join(' '),
  ).not.toMatch(/Hermes connected|Powered by Hermes|claude-sonnet/);
  await page.getByRole('button', { name: /Your workspace/ }).click();
  const workspaceDialog = page.getByRole('dialog');
  await expect(workspaceDialog.locator('details.advanced')).not.toHaveAttribute('open');
  await expect(workspaceDialog.getByText('Runtime diagnostics', { exact: true })).not.toBeVisible();
  await workspaceDialog.locator('details.advanced > summary').click();
  await expect(workspaceDialog.getByText('Local runtime available', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await workspaceDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'New Bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const advanced = dialog.locator('details.advanced');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(dialog.getByLabel('Model access')).not.toBeVisible();
  await expect(dialog.getByText(/Model access must be set up/)).toBeVisible();
  const defaults = await dialog
    .locator('form')
    .evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement)));
  expect(defaults.providerKind).toBe('claude');
  expect(defaults.model).toBe('claude-sonnet-4-6');
  expect(defaults.borrowLogin).toBeUndefined();
  await dialog.getByLabel('Name', { exact: true }).fill('Researcher');
  await dialog
    .getByLabel('What should this Bot do?')
    .fill(
      'Find primary sources, check claims, and prepare a linked research brief. Ask before contacting anyone.',
    );
  await advanced.locator('summary').click();
  await expect(dialog.getByLabel('Use my existing Claude Code login')).not.toBeChecked();
  await dialog.getByLabel('Model', { exact: true }).fill('');
  await advanced.locator('summary').click();
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click();
  await expect(advanced).toHaveAttribute('open');
  await expect(dialog.getByLabel('Model', { exact: true })).toBeFocused();
  await dialog.getByLabel('Model access').selectOption('compatible');
  await dialog.getByLabel('Model', { exact: true }).fill('ui-fixture');
  await dialog.getByLabel('API base URL').fill(`http://127.0.0.1:${endpoint.port}/v1`);
  await advanced.locator('summary').click();
  const retained = await dialog
    .locator('form')
    .evaluate((form) => Object.fromEntries(new FormData(form as HTMLFormElement)));
  expect(retained.providerKind).toBe('compatible');
  expect(retained.model).toBe('ui-fixture');
  expect(retained.baseUrl).toBe(`http://127.0.0.1:${endpoint.port}/v1`);
  await advanced.locator('summary').click();
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveValue('ui-fixture');
  await expect(dialog.getByLabel('API base URL')).toHaveValue(
    `http://127.0.0.1:${endpoint.port}/v1`,
  );
  await advanced.locator('summary').click();
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet Researcher.' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Show Bot details', exact: true }).click();
  await page.getByRole('button', { name: 'Credentials Add access' }).click();
  await page.locator('.panel-content').getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('OPENAI_API_KEY');
  await dialog.getByLabel('Value', { exact: true }).fill('ui-fixture-private-value');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.secret-row').filter({ hasText: 'OPENAI_API_KEY' })).toBeVisible();
  if ((await page.locator('body').innerText()).includes('ui-fixture-private-value'))
    throw new Error('Credential value leaked');
  await page.locator('.panel-tabs').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await dialog
    .getByLabel('Saved memory')
    .fill('Use primary sources. Keep each brief concise, with links and clear decisions.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText(
      'Use primary sources. Keep each brief concise, with links and clear decisions.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Skills Teach a workflow' }).click();
  await page.getByRole('button', { name: 'Add skill', exact: true }).click();
  await dialog.getByLabel('Skill name').fill('source-review');
  await dialog
    .getByLabel('SKILL.md')
    .fill(
      '---\nname: source-review\ndescription: Check primary sources.\n---\n\nFind the primary source for each claim. Return links and uncertainties.',
    );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'source-review Open instructions', exact: true }),
  ).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'launch-brief.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Launch brief\nResearch an open source agent workspace.'),
  });
  await expect(page.getByRole('status')).toContainText('launch-brief.md');
  await page.locator('.panel-tabs').getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add routine', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Weekly source review');
  await dialog
    .getByLabel('Instructions')
    .fill('Review the saved launch brief and suggest source updates. Do not contact anyone.');
  await dialog.getByLabel('When to run').fill('every 24h');
  await dialog.getByRole('button', { name: 'Create routine', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Weekly source review/ })).toBeVisible();
  const routineBot = snapshotSchema
    .parse(await (await page.request.get(`${appUrl}/api/state`)).json())
    .bots.find((b) => b.name === 'Researcher')!;
  const routineDetail = await (
    await page.request.get(`${appUrl}/api/bots/${routineBot.id}`)
  ).json();
  const weekly = routineDetail.routines.find(
    (r: { name: string }) => r.name === 'Weekly source review',
  );
  const outputDir = path.join(
    data,
    'hermes',
    'profiles',
    routineBot.id,
    'cron',
    'output',
    weekly.id,
  );
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, '2026-10-25_12-00-00.md'),
    `# Cron Job: Weekly source review\n\n**Job ID:** ${weekly.id}\n**Run Time:** 2026-10-25T12:00:00Z\n**Schedule:** every 24h\n\n## Prompt\n\nReview sources.\n\n## Response\n\nThe first source review is ready.`,
  );
  const preferenceQuestion = page
    .locator('.transcript')
    .getByRole('form', { name: 'Weekly source review updates' });
  await expect(preferenceQuestion).toContainText('The first source review is ready.', {
    timeout: 15000,
  });
  await expect(preferenceQuestion.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  await expect(preferenceQuestion).not.toContainText('Job ID:');
  await preferenceQuestion.getByRole('button', { name: 'Choose which updates matter…' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'For my "Weekly source review" routine, only update me when…',
  );
  await page.getByLabel('Message', { exact: true }).fill('');

  await preferenceQuestion.getByRole('radio', { name: 'Never', exact: true }).check();
  await preferenceQuestion.getByRole('button', { name: 'Save preference' }).click();
  await expect(preferenceQuestion).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /^Researcher/ })
    .click();
  await expect(preferenceQuestion).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Bot details', exact: true }).click();
  await page.getByRole('button', { name: /^Weekly source review/ }).click();
  const routineSetting = page
    .locator('.panel-content')
    .getByRole('form', { name: 'Weekly source review updates' });
  await expect(routineSetting.getByRole('radio', { name: 'Never', exact: true })).toBeChecked();
  await expect(
    page.locator('.panel-content').getByRole('button', { name: 'Pause', exact: true }),
  ).toBeVisible();
  await routineSetting
    .getByRole('radio', { name: 'Only when something goes wrong', exact: true })
    .check();
  await routineSetting.getByRole('button', { name: 'Save preference' }).click();
  await expect(routineSetting.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  await expect
    .poll(async () => {
      const detail = await (await page.request.get(`${appUrl}/api/bots/${routineBot.id}`)).json();
      return detail.routines.find((r: { id: string }) => r.id === weekly.id)?.updatePreference;
    })
    .toBe('errors');
  await routineSetting.getByRole('radio', { name: 'Keep all updates', exact: true }).check();
  await routineSetting.getByRole('button', { name: 'Save preference' }).click();
  await expect
    .poll(async () => {
      const detail = await (await page.request.get(`${appUrl}/api/bots/${routineBot.id}`)).json();
      return detail.routines.find((r: { id: string }) => r.id === weekly.id)?.updatePreference;
    })
    .toBe('all');
  await page.locator('.panel-tabs').getByRole('button', { name: 'Overview', exact: true }).click();

  await page
    .getByLabel('Message', { exact: true })
    .fill('Review the launch brief and tell me what to do next.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.locator('.bubble').filter({ hasText: 'I reviewed the launch brief.' }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  await page.screenshot({ path: path.join(artifacts, 'workspace-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Weekly source review', exact: false }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /Researcher/ })
    .click();
  await expect(
    page.locator('.bubble').filter({ hasText: 'I reviewed the launch brief.' }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByLabel('Message', { exact: true })
    .fill('UI_QUESTION_PROOF: ask me about the launch.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Researcher question' })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /Researcher/ })
    .click();
  const questionCard = page.getByRole('region', { name: 'Researcher question' });
  await expect(questionCard).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Show Bot details', exact: true }).click();
  await expect(
    page.getByText(
      'Use primary sources. Keep each brief concise, with links and clear decisions.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Include source links when you continue.');
  await page.getByRole('button', { name: 'Steer Bot', exact: true }).click();
  await expect(
    page.getByText('Steering queued for the next tool result', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'question-desktop.png'), fullPage: true });
  await questionCard.getByRole('radio', { name: /Green/ }).check();
  await questionCard.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(questionCard).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  const activity = page.locator('.transcript-activity').filter({ hasText: 'Clarify' }).first();
  await expect(activity).toBeVisible();
  await expect(activity.locator('pre')).not.toBeVisible();
  await activity.locator(':scope > summary').click();
  const action = activity.locator('.transcript-action').first();
  await expect(action.locator('summary')).toBeVisible();
  await expect(action.locator('pre')).not.toBeVisible();
  await action.locator('summary').click();
  await expect(action.locator('pre')).toContainText('Which launch color should I use?');
  await activity.locator(':scope > summary').click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('UI_APPROVAL_PROOF: remove the temporary target.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const approvalCard = page.getByRole('region', { name: 'Researcher approval request' });
  await expect(approvalCard).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: path.join(artifacts, 'approval-desktop.png'), fullPage: true });
  await approvalCard.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvalCard).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  await page.getByLabel('Message', { exact: true }).fill('UI_STOP_PROOF: ask before continuing.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(questionCard).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Stop Bot', exact: true }).click();
  await expect(questionCard).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thread', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
  await expect(
    page.locator('.bubble').filter({ hasText: 'I reviewed the launch brief.' }).first(),
  ).toBeVisible({ timeout: 30000 });
  // Configure primary Bot through the same settings form for a two-profile group.
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /^Hermes/ })
    .click();
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click();
  await expect(advanced).not.toHaveAttribute('open');
  await advanced.locator('summary').click();
  await dialog.getByLabel('Model access').selectOption('compatible');
  await dialog.getByLabel('Model', { exact: true }).fill('ui-fixture');
  await dialog.getByLabel('API base URL').fill(`http://127.0.0.1:${endpoint.port}/v1`);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await dialog.getByLabel('Group name').fill('Launch team');
  await dialog.getByLabel('Hermes', { exact: true }).check();
  await dialog.getByLabel('Researcher', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Better together.' })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Review this plan together.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.locator('.bubble').filter({ hasText: 'I reviewed the launch brief.' }),
  ).toHaveCount(2, { timeout: 60000 });
  await page.screenshot({ path: path.join(artifacts, 'group-desktop.png'), fullPage: true });
  // A native scheduled turn asks a question while another conversation is open.
  const snapshot = snapshotSchema.parse(
    await (await page.request.get(`${appUrl}/api/state?projection=canonical`)).json(),
  );
  const researcher = snapshot.bots.find((b) => b.name === 'Researcher');
  if (!researcher) throw new Error('Researcher missing');
  const roster = page.getByRole('navigation', { name: 'Bots' });
  const researcherRow = roster.getByRole('button', { name: /^Researcher/ });
  await researcherRow.click();
  await expect
    .poll(async () => {
      const state = snapshotSchema.parse(
        await (await page.request.get(`${appUrl}/api/state?projection=canonical`)).json(),
      );
      return state.inbox.conversations
        .filter((c) => c.botId === researcher.id)
        .reduce((n, c) => n + c.unread, 0);
    })
    .toBe(0);
  const scheduled = await page.request.post(`${appUrl}/api/bots/${researcher.id}/routines`, {
    data: {
      name: 'UI_PROACTIVE_QUESTION_PROOF',
      prompt: 'Prepare the saved brief for review.',
      schedule: new Date(Date.now() + 2000).toISOString(),
    },
  });
  expect(scheduled.ok()).toBe(true);
  await roster.getByRole('button', { name: /^Hermes/ }).click();
  await expect
    .poll(
      async () => {
        const state = snapshotSchema.parse(
          await (await page.request.get(`${appUrl}/api/state?projection=canonical`)).json(),
        );
        return state.requests.some((r) => r.botId === researcher.id && r.kind === 'clarify');
      },
      { timeout: 90000 },
    )
    .toBe(true);
  await researcherRow.click();
  const proactiveQuestion = page.getByRole('region', { name: 'Researcher question' });
  await expect(proactiveQuestion).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.routine-delivery')).toContainText('UI_PROACTIVE_QUESTION_PROOF');
  await proactiveQuestion.getByRole('radio', { name: /Green/ }).check();
  await proactiveQuestion.getByRole('button', { name: 'Send answer', exact: true }).click();
  await page.getByRole('button', { name: 'Computer', exact: true }).click();
  await expect(researcherRow.locator('.unread-badge')).toHaveText('1', { timeout: 30000 });
  await page.screenshot({ path: path.join(artifacts, 'proactive-unread.png'), fullPage: true });
  // Reload selects Hermes. The unseen reply remains unread until Researcher's chat is shown.
  await page.reload();
  await expect(researcherRow.locator('.unread-badge')).toHaveText('1', { timeout: 15000 });
  await researcherRow.click();
  await expect(page.locator('.routine-delivery')).toBeVisible();
  await expect(researcherRow.locator('.unread-badge')).toHaveCount(0, { timeout: 15000 });
  await page.locator('.routine-delivery summary').click();
  await expect(page.locator('.routine-output')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'proactive-chat.png'), fullPage: true });
  const legacyRun = await page.request.post(`${appUrl}/api/bots/${researcher.id}/messages`, {
    data: {
      title: 'Source checklist',
      text: 'UI_LEGACY_QUESTION_PROOF: ask before preparing the source checklist.',
    },
  });
  expect(legacyRun.status()).toBe(202);
  await expect(questionCard).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toBeVisible();
  await expect(page.getByText('Source checklist', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
  await page.reload();
  await researcherRow.click();
  await expect(questionCard).toBeVisible({ timeout: 15000 });
  await questionCard.getByRole('radio', { name: /Green/ }).check();
  await questionCard.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(questionCard).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  const legacyDetail = await (
    await page.request.get(`${appUrl}/api/bots/${researcher.id}?title=Source%20checklist`)
  ).json();
  expect(legacyDetail.messages.some((m: { role: string }) => m.role === 'assistant')).toBe(true);
  await expect(researcherRow.locator('.unread-badge')).toHaveCount(0);
  const mainResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/bots/${researcher.id}/messages`) &&
      response.request().method() === 'POST',
  );
  const mainSend = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/bots/${researcher.id}/messages`) && request.method() === 'POST',
  );
  await page.getByLabel('Message', { exact: true }).fill('Continue our main chat.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  expect((await mainSend).postDataJSON().title).toBe('Bot Chat');
  expect((await mainResponse).status()).toBe(202);
  await expect
    .poll(
      async () => {
        const state = snapshotSchema.parse(
          await (await page.request.get(`${appUrl}/api/state?projection=canonical`)).json(),
        );
        return state.running.some((run) => run.botId === researcher.id);
      },
      { timeout: 30000 },
    )
    .toBe(false);
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  const launchGroup = snapshot.groups.find((g) => g.name === 'Launch team');
  if (!launchGroup) throw new Error('Launch group missing');
  const groupRun = await page.request.post(`${appUrl}/api/groups/${launchGroup.id}/messages`, {
    data: {
      text: 'Prepare another joint review while I read the private conversation.',
    },
  });
  expect(groupRun.status()).toBe(202);
  const groupRow = page.locator('.group-row').filter({ hasText: 'Launch team' });
  await expect(groupRow.locator('.unread-badge')).toHaveText('2', { timeout: 60000 });
  await page.reload();
  await expect(groupRow.locator('.unread-badge')).toHaveText('2', { timeout: 15000 });
  await groupRow.click();
  await expect(groupRow.locator('.unread-badge')).toHaveCount(0, { timeout: 15000 });

  await page.setViewportSize({ width: 390, height: 650 });
  await expect(page.locator('.details-panel')).toHaveCount(0);
  const detailsOpener = page.getByRole('button', { name: 'Show group details', exact: true });
  await detailsOpener.focus();
  await page.keyboard.press('Enter');
  const detailsSheet = page.getByRole('dialog', { name: 'Group details', exact: true });
  await expect(detailsSheet).toBeVisible();
  await expect(page.locator('.chat-column')).toHaveAttribute('inert');
  await detailsSheet.getByRole('button', { name: 'Close details', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await detailsSheet.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(detailsSheet).toHaveCount(0);
  await expect(detailsOpener).toBeFocused();
  await detailsOpener.click();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(detailsOpener).toBeFocused();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /Researcher/ })
    .click();
  await expect(page.getByRole('button', { name: 'Thread', exact: true })).toHaveCount(0);
  const composerBox = await page.locator('.composer').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(650);
  const botDetailsOpener = page.getByRole('button', { name: 'Show Bot details', exact: true });
  await botDetailsOpener.click();
  await expect(page.getByRole('dialog', { name: 'Bot details', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await page.getByRole('button', { name: 'Edit Bot', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(botDetailsOpener).toBeFocused();
  const sidebarOpener = page.getByRole('button', { name: 'Open sidebar', exact: true });
  await sidebarOpener.click();
  await page.getByRole('button', { name: 'New Bot', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
  await expect(sidebarOpener).toBeFocused();
  await botDetailsOpener.click();
  await page.setViewportSize({ width: 1440, height: 950 });
  await expect(page.locator('.sidebar')).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: 'New Bot', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create a Bot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 650 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: path.join(artifacts, 'workspace-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  console.log(
    'Browser passed: bot resources, persistent native chat, question recovery after reload, live steering, approval denial, Stop clears cards, routines, canonical Bot chat, legacy request recovery, two-Bot group, proactive native questions, unread preservation on Computer/reload, Bot/group unread separation, read-on-view, mobile layout.',
  );
  await browser.close();
  await stopBackend();
  const desktopEnv: Record<string, string> = { TEAMMATES_DATA_DIR: data };
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined && name !== 'ELECTRON_RUN_AS_NODE') desktopEnv[name] = value;
  const desktop = await _electron.launch({
    ...(process.env.TEAMMATES_PACKAGED_EXECUTABLE
      ? { executablePath: process.env.TEAMMATES_PACKAGED_EXECUTABLE, args: [] }
      : { args: ['electron/main.cjs'] }),
    env: desktopEnv,
    timeout: 30000,
  });
  try {
    const window = await desktop.firstWindow();
    await expect(window.getByRole('heading', { name: 'Meet Hermes.', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(window.getByRole('button', { name: 'New Bot', exact: true })).toBeVisible();
    await window
      .getByRole('navigation', { name: 'Bots' })
      .getByRole('button', { name: /Researcher/ })
      .click();
    const nativeControls = process.platform === 'darwin';
    if (nativeControls) {
      await expect(window.locator('.composer')).toHaveAttribute('data-native-controls', 'active');
      await expect(window.locator('.chat-header')).toHaveAttribute(
        'data-native-controls',
        'active',
      );
      console.log('Native desktop controls ready.');
    }
    if (!nativeControls || process.env.TEAMMATES_NATIVE_INTERACTIVE === '1') {
      if (!nativeControls) {
        await window
          .getByLabel('Message', { exact: true })
          .fill('UI_DESKTOP_QUESTION_PROOF: ask which color to use.');
        await window.getByRole('button', { name: 'Send message', exact: true }).click();
      } else {
        fs.writeFileSync(path.join(artifacts, 'native-desktop-ready'), 'ready\n');
        console.log('Waiting for native input: UI_DESKTOP_QUESTION_PROOF: ask which color to use.');
      }
      const question = window.getByRole('region', { name: 'Researcher question' });
      await expect(question).toBeVisible({ timeout: nativeControls ? 180000 : 30000 });
      await window.screenshot({ path: path.join(artifacts, 'electron-desktop.png') });
      await question.getByRole('radio', { name: /Green/ }).check();
      await question.getByRole('button', { name: 'Send answer', exact: true }).click();
      await expect(question).toHaveCount(0);
      await expect(window.locator('.composer')).toBeAttached();
      await expect
        .poll(
          async () => {
            const response = await window.request.get(
              new URL('/api/state?projection=canonical', window.url()).href,
            );
            const state = await response.json();
            return state.running.length;
          },
          { timeout: 30000 },
        )
        .toBe(0);
      console.log(
        'Electron passed: persistent gateway, resumed history, real question tool and answer.',
      );
    } else {
      console.log(
        'Electron passed: resumed history and native AppKit presentation. Native input requires the separate interactive acceptance lane.',
      );
    }
  } finally {
    await desktop.close();
  }
} catch (error) {
  if (!page.isClosed())
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await stopBackend();
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  fs.rmSync(data, { recursive: true, force: true });
}
