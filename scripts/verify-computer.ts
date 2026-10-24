import { chromium, _electron, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Computers } from '../server/computers';
import { Store } from '../server/store';
import { z } from 'zod';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-computer-ui-'));
const probe = http.createServer();
probe.listen(0, '127.0.0.1');
await new Promise<void>((r) => probe.once('listening', r));
const address = probe.address();
if (!address || typeof address === 'string') throw new Error('No port');
const port = address.port;
await new Promise<void>((r) => probe.close(() => r()));
let base = `http://127.0.0.1:${port}`;
const executablePath = process.env.TEAMMATES_PACKAGED_EXECUTABLE;
const launchEnv: Record<string, string> = { TEAMMATES_DATA_DIR: root };
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined && key !== 'TEAMMATES_DATA_DIR') launchEnv[key] = value;
delete launchEnv.ELECTRON_RUN_AS_NODE;
const desktop = executablePath
  ? await _electron.launch({ executablePath, env: launchEnv })
  : undefined;
const backend = desktop
  ? undefined
  : spawn(process.execPath, ['dist/server/index.js'], {
      env: { ...process.env, PORT: String(port), TEAMMATES_DATA_DIR: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
let logs = '';
backend?.stdout.on('data', (c) => (logs += String(c)));
backend?.stderr.on('data', (c) => (logs += String(c)));
const browser = desktop ? undefined : await chromium.launch();
const page = desktop
  ? await desktop.firstWindow()
  : await browser?.newPage({ viewport: { width: 1440, height: 1050 } });
if (!page) throw new Error('No browser window');
if (desktop) {
  await expect.poll(() => page.url()).toMatch(/^http:\/\/127\.0\.0\.1:/);
  base = new URL(page.url()).origin;
}
let cleaner: Computers | undefined;
try {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${base}/api/state`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        z
          .object({ runtime: z.object({ available: z.boolean() }) })
          .parse(await (await fetch(`${base}/api/state`)).json()).runtime.available,
      { timeout: 30000 },
    )
    .toBe(true);
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('Browser:', message.text());
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Computer', exact: true }).click();
  await page.getByRole('button', { name: 'Set up computer', exact: true }).click();
  await expect(page.getByText('Watching live.', { exact: false })).toBeVisible({ timeout: 240000 });
  await expect(page.locator('[data-testid="computer-screen"] canvas')).toBeVisible();
  await expect(page.locator('.computer-dot.online')).toBeVisible({ timeout: 20000 });
  const descriptor = z
    .object({ token: z.string() })
    .parse(JSON.parse(fs.readFileSync(path.join(root, 'hermes/.teammates-computer.json'), 'utf8')));
  async function shell(command: string) {
    const response = await fetch(`${base}/api/bots/default/computer-tools/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${descriptor.token}` },
      body: JSON.stringify({ command }),
    });
    if (!response.ok) throw new Error(await response.text());
    return z.object({ output: z.string() }).parse(await response.json()).output;
  }
  await shell(
    `printf '%s' '<html><head><title>Teammates computer proof</title></head><body style="background:#242629;color:#e9e8e3;font:24px system-ui;padding:70px"><small style="color:#b6c9a1">HERMES TEAMMATES</small><h1>Your Bot’s computer</h1><p>Browser, files and terminal in its own Linux VM.</p><input placeholder="Type here" style="font:24px system-ui;padding:12px;border-radius:8px"/></body></html>' > ui-proof.html`,
  );
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(page.getByText('You have control', { exact: true })).toBeVisible();
  const canvas = page.locator('[data-testid="computer-screen"] canvas');
  await canvas.click({ position: { x: 150, y: 150 } });
  await page.keyboard.press('Control+l');
  // Allow the guest browser to focus its address bar across the remote display.
  await page.waitForTimeout(300);
  await page.keyboard.type('file:///home/bot/workspace/ui-proof.html', { delay: 25 });
  await page.keyboard.press('Enter');
  // Hand-back proves controls crossed the live noVNC connection before querying the guest.
  await page.getByRole('button', { name: 'Hand back', exact: true }).click();
  await expect
    .poll(() => shell('xdotool getactivewindow getwindowname'), { timeout: 20000 })
    .toContain('Teammates computer proof');
  await page.screenshot({
    path: `test-artifacts/computer-${desktop ? 'packaged' : 'workspace'}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Computer', exact: true }).click();
  await expect(page.locator('.computer-dot.online')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Sleep', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wake computer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Wake computer', exact: true }).click();
  await expect(page.locator('.computer-dot.online')).toBeVisible({ timeout: 60000 });
  await page.reload();
  await page.getByRole('button', { name: 'Computer', exact: true }).click();
  await expect(page.locator('.computer-dot.online')).toBeVisible({ timeout: 30000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-artifacts/computer-mobile.png', fullPage: true });
  assertNoErrors(errors);
  cleaner = new Computers(new Store(root), () => {});
  console.log(
    'Compiled computer UI passed: VNC pixels, manual browser navigation, hand-back, sleep/wake, reload, mobile width and no page errors.',
  );
} catch (error) {
  await page
    .screenshot({ path: 'test-artifacts/computer-failure.png', fullPage: true })
    .catch(() => {});
  if (process.env.TEAMMATES_DEBUG) {
    const debug = new Computers(new Store(root), () => {});
    try {
      console.error((await debug.command(['logs', debug.name('default')])).toString().slice(-4000));
    } catch {}
    await debug.close();
  }
  throw error;
} finally {
  await browser?.close();
  await desktop?.close();
  if (backend) {
    backend.kill('SIGTERM');
    await new Promise<void>((r) => {
      if (backend.exitCode !== null) r();
      else backend.once('exit', () => r());
    });
  }
  cleaner ||= new Computers(new Store(root), () => {});
  await cleaner.close();
  const name = cleaner.name('default');
  await cleaner.command(['delete', name]).catch(() => {});
  await cleaner.command(['volume', 'delete', name]).catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
  if (process.env.TEAMMATES_DEBUG) console.error(logs);
}
function assertNoErrors(errors: string[]) {
  if (errors.length) throw new Error(errors.join('\n'));
}
