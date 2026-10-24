import { chromium, expect } from '@playwright/test';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
const artifacts = path.resolve('test-artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const owned = !process.env.TEAMMATES_MOBILE_FIXTURE_RUNNING;
if (owned)
  for (const port of [14310, 14311, 14312])
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', () =>
        reject(new Error(`Port ${port} is busy. Stop the existing fixture first.`)),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    });
const fixtureRoot = owned
  ? fs.mkdtempSync(path.join(artifacts, 'mobile-browser-'))
  : path.join(artifacts, 'mobile-host');
const child = owned
  ? spawn(process.execPath, ['--import', 'tsx', 'scripts/mobile-fixture.ts'], {
      stdio: 'ignore',
      env: { ...process.env, TEAMMATES_MOBILE_FIXTURE_DIR: fixtureRoot },
    })
  : undefined;
async function local(route: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:14310${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Fixture request ${res.status}`);
  return res.json();
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch('http://127.0.0.1:14312')).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  type TransportResponse = { status: number; body: string };
  let beforeResponse:
    | ((
        url: string,
        method: string,
        response: TransportResponse,
      ) => { wait: Promise<void>; complete: () => void } | undefined)
    | undefined;
  function holdResponses(matches: (url: URL, method: string) => boolean) {
    const pending: {
      body: string;
      release: () => void;
      delivered: Promise<void>;
    }[] = [];
    beforeResponse = (url, method, response) => {
      if (!matches(new URL(url), method)) return;
      let release!: () => void;
      let complete!: () => void;
      const wait = new Promise<void>((resolve) => (release = resolve));
      const delivered = new Promise<void>((resolve) => (complete = resolve));
      pending.push({ body: response.body, release, delivered });
      return { wait, complete };
    };
    async function releaseWhere(matchesBody: (body: string) => boolean) {
      const selected = pending.filter((p) => matchesBody(p.body));
      for (const p of selected) p.release();
      await Promise.all(selected.map((p) => p.delivered));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    }
    return {
      pending,
      releaseWhere,
      async finish() {
        beforeResponse = undefined;
        await releaseWhere(() => true);
      },
    };
  }
  // Browser-only stand-in for CapacitorHttp's native transport. TLS validates against our fixture CA.
  await page.route('https://localhost:14311/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE',
        },
      });
      return;
    }
    const request = route.request();
    const response = await new Promise<TransportResponse>((resolve, reject) => {
      const req = https.request(
        request.url(),
        {
          method: request.method(),
          ca: fs.readFileSync(path.join(fixtureRoot, 'cert.pem')),
          headers: {
            'Content-Type': 'application/json',
            ...(request.headers().authorization
              ? { Authorization: request.headers().authorization }
              : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += String(c)));
          res.on('end', () => resolve({ status: res.statusCode!, body }));
        },
      );
      req.on('error', reject);
      req.end(request.postData() || undefined);
    });
    const held = beforeResponse?.(request.url(), request.method(), response);
    await held?.wait;
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: response.body,
    });
    held?.complete();
  });
  await page.goto('http://127.0.0.1:14312');
  await desktop.goto('http://127.0.0.1:14310');
  await desktop.getByText('Mobile devices', { exact: true }).click();
  await desktop.getByRole('button', { name: 'Create pairing code', exact: true }).click();
  const pairingCode = await desktop.locator('.pair-code').textContent();
  expect(pairingCode).toBeTruthy();
  await page.getByLabel('Host address').fill('https://localhost:14311');
  await page.getByLabel('Pairing code').fill(pairingCode!);
  await page.getByRole('button', { name: 'Connect workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Bots', exact: true })).toBeVisible();
  await expect(
    desktop.getByRole('button', { name: 'Revoke Browser check', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New Bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Mobile researcher');
  await dialog
    .getByLabel('Job and instructions')
    .fill('Find reliable sources for the mobile launch.');
  await dialog.getByLabel('Model access').selectOption('compatible');
  await dialog.getByLabel('Model ID').fill('mobile-fixture');
  const snapshot = await local('/api/state');
  const baseUrl = snapshot.bots.find((b: { id: string }) => b.id === 'default').provider.baseUrl;
  await dialog.getByLabel('API base URL').fill(baseUrl);
  await dialog.getByRole('button', { name: 'Create Bot', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mobile researcher Find reliable/ })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'mobile-roster.png') });
  await page.getByRole('button', { name: /Mobile researcher Find reliable/ }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('MOBILE_QUESTION_BROWSER');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which launch color should I use?', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByLabel('Green (Recommended)', { exact: true }).check();
  await page
    .getByRole('textbox', { name: 'Steer Bot', exact: true })
    .fill('Keep the answer concise.');
  await page.getByRole('button', { name: 'Send steering', exact: true }).click();
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(
    page.getByText('I reviewed the mobile launch brief. The sources are ready for your review.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('MOBILE_APPROVAL_BROWSER');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Your approval is needed', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByText('Your approval is needed', { exact: true })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('MOBILE_STOP_BROWSER');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Which launch color should I use?', { exact: true })).toBeVisible({
    timeout: 60000,
  });
  // Keep an old running snapshot in flight while steering and Stop execute.
  const heldState = holdResponses((url) => url.pathname === '/api/state');
  await page.getByRole('textbox', { name: 'Steer Bot', exact: true }).fill('Wait for my decision.');
  await page.getByRole('button', { name: 'Send steering', exact: true }).click();
  await expect.poll(() => heldState.pending.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await local('/api/state')).running.length).toBe(0);
  // Resume must accept its new idle snapshot and ignore every older response.
  async function visibility(value: 'hidden' | 'visible') {
    await page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, value);
  }
  await visibility('hidden');
  await expect(page.getByRole('textbox', { name: 'Steer Bot', exact: true })).toHaveCount(0);
  const beforeResume = heldState.pending.length;
  await visibility('visible');
  await expect.poll(() => heldState.pending.length).toBeGreaterThan(beforeResume);
  await heldState.releaseWhere((body) => JSON.parse(body).running.length === 0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await heldState.finish();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(page.getByText('Which launch color should I use?', { exact: true })).toHaveCount(0, {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Bot details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await page.getByLabel('Bot memory').fill('Prefer primary sources.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Prefer primary sources.', { exact: true })).toBeVisible();
  // Reopen details with its initial memory response delayed; never offer a blank editor.
  const heldDetail = holdResponses(
    (url, method) => method === 'GET' && /^\/api\/bots\/[^/]+$/.test(url.pathname),
  );
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click();
  await page.getByRole('button', { name: /Mobile researcher Find reliable/ }).click();
  await page.getByRole('button', { name: 'Bot details', exact: true }).click();
  await expect.poll(() => heldDetail.pending.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Edit memory', exact: true })).toBeDisabled();
  await expect(page.getByText('Loading memory…', { exact: true })).toBeVisible();
  await heldDetail.finish();
  await expect(page.getByRole('button', { name: 'Edit memory', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit memory', exact: true }).click();
  await expect(page.getByLabel('Bot memory')).toHaveValue('Prefer primary sources.');
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  await page.getByRole('button', { name: 'Add routine', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Mobile roundup');
  await dialog.getByLabel('Task', { exact: true }).fill('Review the launch brief.');
  await dialog.getByLabel('Schedule', { exact: true }).fill('every 2h');
  await dialog.getByRole('button', { name: 'Create routine', exact: true }).click();
  await expect(page.getByText('Mobile roundup', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bot details', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Review the launch brief before the routine.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click();
  // Use the Bot whose interactive Hermes gateway is already active, as in desktop acceptance.
  const researcher = (await local('/api/state')).bots.find(
    (b: { name: string }) => b.name === 'Mobile researcher',
  );
  await local(`/api/bots/${researcher.id}/routines`, {
    name: 'MOBILE_QUESTION_PROACTIVE',
    prompt: 'Review the mobile launch brief.',
    schedule: new Date(Date.now() + 3000).toISOString(),
  });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mobile researcher needs you/ })).toBeVisible({
    timeout: 120000,
  });
  await page.getByRole('button', { name: /Mobile researcher needs you/ }).click();
  await expect(page.getByText('Which launch color should I use?', { exact: true })).toBeVisible();
  await page.getByLabel('Blue', { exact: true }).check();
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(
    page
      .getByText('I reviewed the mobile launch brief. The sources are ready for your review.', {
        exact: true,
      })
      .last(),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Back to Bots', exact: true }).click();
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Mobile launch');
  await dialog.getByLabel('Hermes', { exact: true }).check();
  await dialog.getByLabel('Mobile researcher', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('button', { name: /Mobile launch Hermes/ }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Review the launch brief.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('I reviewed the mobile launch brief. The sources are ready for your review.', {
      exact: true,
    }),
  ).toHaveCount(2, { timeout: 60000 });
  await page.screenshot({ path: path.join(artifacts, 'mobile-conversation.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await desktop.getByRole('button', { name: 'Revoke Browser check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect workspace', exact: true })).toBeVisible();
  process.stdout.write(
    'Compiled mobile acceptance passed: pairing, roster/create, native question, steering, answer, approval denial, Stop during delayed refresh, resume response ordering, safe memory loading/editing, routine pause, proactive routine question through Activity, group replies, revocation, no overflow/page errors. Native transport is a fixture stand-in in this browser lane.\n',
  );
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await stopped;
    clearTimeout(timeout);
  }
  if (owned) fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
