import { chromium, _electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { appModelFixture } from '../test/fixtures/app-model';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-app-ui-'));
const fixture = appModelFixture();
fixture.server.listen(0, '127.0.0.1');
await new Promise<void>((r) => fixture.server.once('listening', r));
const endpoint = fixture.server.address();
if (!endpoint || typeof endpoint === 'string') throw new Error('Fixture port missing');
const probe = http.createServer();
probe.listen(0, '127.0.0.1');
await new Promise<void>((r) => probe.once('listening', r));
const address = probe.address();
if (!address || typeof address === 'string') throw new Error('Port missing');
await new Promise<void>((r) => probe.close(() => r()));
const backend = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, TEAMMATES_DATA_DIR: root, PORT: String(address.port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
backend.stderr.resume();
const url = `http://127.0.0.1:${address.port}`;
const output = path.join(root, 'executions.jsonl');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timed out')), 30000);
    backend.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    backend.on('error', reject);
  });
  await page.goto(url);
  await expect(page.getByText('Hermes connected', { exact: true })).toBeVisible({ timeout: 30000 });
  const bot = await page.request.put(`${url}/api/bots/default`, {
    data: {
      name: 'Hermes',
      role: 'Use the connected messenger.',
      color: 'orange',
      provider: {
        kind: 'compatible',
        model: 'fixture-model',
        baseUrl: `http://127.0.0.1:${endpoint.port}/v1`,
      },
    },
  });
  expect(bot.ok()).toBeTruthy();
  const secret = await page.request.put(`${url}/api/bots/default/secrets/OPENAI_API_KEY`, {
    data: { value: 'synthetic-ui-provider' },
  });
  expect(secret.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Apps Connect tools to this Bot' }).click();
  await page.getByRole('button', { name: 'Connect app', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('App name', { exact: true }).fill('Team messenger');
  await dialog.getByLabel('Connection type').selectOption('stdio');
  await dialog.getByLabel('Command', { exact: true }).fill(process.execPath);
  await dialog
    .getByLabel('Arguments, as a JSON array')
    .fill(JSON.stringify([path.resolve('test/fixtures/app-mcp.mjs'), output]));
  await dialog.getByRole('button', { name: 'Connect app', exact: true }).click();
  await expect(page.locator('.connection-card')).toContainText('Team messenger');
  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/app-connections.png', fullPage: true });
  const composer = page.getByPlaceholder('Message Hermes…');
  await composer.fill('APP_REVIEW_ALLOW: send the draft.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const review = page.getByRole('region', { name: 'Hermes app action review' });
  await expect(review).toBeVisible({ timeout: 40000 });
  expect(fs.existsSync(output)).toBe(false);
  await page.reload();
  await expect(review).toBeVisible({ timeout: 15000 });
  await review.getByLabel('Action parameters').fill('{ broken JSON');
  await review.getByRole('button', { name: 'Run reviewed action' }).click();
  await expect(review.getByRole('alert')).toContainText('Enter a JSON object');
  await review
    .getByLabel('Action parameters')
    .fill(
      JSON.stringify(
        { recipient: 'team@example.test', text: 'The launch brief is ready for your review.' },
        null,
        2,
      ),
    );
  await expect(page.getByText('Loading conversation…', { exact: true })).toBeHidden({
    timeout: 15000,
  });
  await page.screenshot({ path: 'test-artifacts/app-action-review.png', fullPage: true });
  await review.getByRole('button', { name: 'Run reviewed action' }).click();
  await expect(review).toBeHidden({ timeout: 15000 });
  await expect
    .poll(() => (fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : ''))
    .toContain('team@example.test');
  expect(JSON.parse(fs.readFileSync(output, 'utf8').trim()).args.text).toBe(
    'The launch brief is ready for your review.',
  );
  await expect(page.getByText('App review proof complete.', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  expect(errors).toEqual([]);
  if (process.env.TEAMMATES_PACKAGED_EXECUTABLE) {
    await browser.close();
    await new Promise<void>((r) => {
      backend.once('exit', () => r());
      backend.kill('SIGTERM');
    });
    const desktop = await _electron.launch({
      executablePath: process.env.TEAMMATES_PACKAGED_EXECUTABLE,
      env: Object.fromEntries(
        Object.entries({ ...process.env, TEAMMATES_DATA_DIR: root }).filter(
          (entry): entry is [string, string] =>
            entry[0] !== 'ELECTRON_RUN_AS_NODE' && typeof entry[1] === 'string',
        ),
      ),
    });
    try {
      const window = await desktop.firstWindow();
      await expect(window.getByText('Hermes connected', { exact: true })).toBeVisible({
        timeout: 30000,
      });
      await window
        .getByLabel('Message', { exact: true })
        .fill('APP_REVIEW_DESKTOP: send the draft.');
      await window.getByRole('button', { name: 'Send message', exact: true }).click();
      const card = window.getByRole('region', { name: 'Hermes app action review' });
      await expect(card).toBeVisible({ timeout: 40000 });
      await card.getByLabel('Action parameters').fill(
        JSON.stringify({
          recipient: 'desktop@example.test',
          text: 'Reviewed from the packaged app',
        }),
      );
      await card.getByRole('button', { name: 'Run reviewed action' }).click();
      await expect.poll(() => fs.readFileSync(output, 'utf8').trim().split('\n').length).toBe(2);
      expect(JSON.parse(fs.readFileSync(output, 'utf8').trim().split('\n')[1]).args.recipient).toBe(
        'desktop@example.test',
      );
      console.log('Packaged Electron app executed the reviewed native MCP parameters.');
    } finally {
      await desktop.close();
    }
  }
  console.log(
    'Compiled app connection and editable native review passed, including reload, invalid JSON and 390px layout.',
  );
} finally {
  await browser.close();
  if (backend.exitCode === null && backend.signalCode === null)
    await new Promise<void>((r) => {
      backend.once('exit', () => r());
      backend.kill('SIGTERM');
    });
  await new Promise<void>((r) => fixture.server.close(() => r()));
  fs.rmSync(root, { recursive: true, force: true });
}
