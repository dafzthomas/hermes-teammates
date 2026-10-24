import { chromium, _electron, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

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
    'UI_DESKTOP_QUESTION_PROOF',
  ]) {
    if (!history.includes(marker) || interactiveIssued.has(marker)) continue;
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${address.port}`);
  await expect(page.getByText('Hermes connected', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Meet Hermes.', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'New Bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Researcher');
  await dialog
    .getByLabel('What should this Bot do?')
    .fill(
      'Find primary sources, check claims, and prepare a linked research brief. Ask before contacting anyone.',
    );
  await dialog.getByLabel('Model access').selectOption('compatible');
  await dialog.getByLabel('Model', { exact: true }).fill('ui-fixture');
  await dialog.getByLabel('API base URL').fill(`http://127.0.0.1:${endpoint.port}/v1`);
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet Researcher.' })).toBeVisible({
    timeout: 30000,
  });
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
  await page.getByRole('button', { name: 'Thread', exact: true }).click();
  await dialog.getByLabel('Thread name').fill('Source checklist');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Source checklist', { exact: true })).toBeVisible();
  await expect(page.locator('.bubble')).toHaveCount(0);
  await page.getByRole('button', { name: 'Main conversation', exact: true }).click();
  await expect(
    page.locator('.bubble').filter({ hasText: 'I reviewed the launch brief.' }).first(),
  ).toBeVisible({ timeout: 30000 });
  // Configure primary Bot through the same settings form for a two-profile group.
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /^Hermes/ })
    .click();
  await page.getByRole('button', { name: 'Bot settings', exact: true }).click();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Bots' })
    .getByRole('button', { name: /Researcher/ })
    .click();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: path.join(artifacts, 'workspace-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  console.log(
    'Browser passed: bot resources, persistent native chat, question recovery after reload, live steering, approval denial, Stop clears cards, routines, threads, two-Bot group, mobile layout.',
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
    await expect(window.getByText('Hermes connected', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(window.getByRole('button', { name: 'New Bot', exact: true })).toBeVisible();
    await window
      .getByRole('navigation', { name: 'Bots' })
      .getByRole('button', { name: /Researcher/ })
      .click();
    await window
      .getByLabel('Message', { exact: true })
      .fill('UI_DESKTOP_QUESTION_PROOF: ask which color to use.');
    await window.getByRole('button', { name: 'Send message', exact: true }).click();
    const question = window.getByRole('region', { name: 'Researcher question' });
    await expect(question).toBeVisible({ timeout: 30000 });
    await window.screenshot({ path: path.join(artifacts, 'electron-desktop.png') });
    await question.getByRole('radio', { name: /Green/ }).check();
    await question.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect(window.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
      timeout: 30000,
    });
    console.log(
      'Electron passed: native window, persistent gateway, resumed history, real question tool and answer.',
    );
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
