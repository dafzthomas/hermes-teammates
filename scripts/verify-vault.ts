import { chromium, _electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { Store } from '../server/store';
import { vaultModelFixture } from '../test/fixtures/vault-model';

async function port() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port missing');
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-vault-ui-'));
const modelPort = await port();
const cdpPort = await port();
const appPort = await port();
const fixture = vaultModelFixture(`http://127.0.0.1:${modelPort}/login`);
fixture.server.listen(modelPort, '127.0.0.1');
await new Promise<void>((r) => fixture.server.once('listening', r));
const target = await chromium.launch({ args: [`--remote-debugging-port=${cdpPort}`] });
const targetContext = await target.newContext();
const loginPage = await targetContext.newPage();
await loginPage.goto(`http://127.0.0.1:${modelPort}/login`);
const store = new Store(root);
store.updateBot('default', {
  name: 'Hermes',
  role: 'Use the native browser vault tools.',
  color: 'orange',
  provider: {
    kind: 'compatible',
    model: 'fixture-model',
    baseUrl: `http://127.0.0.1:${modelPort}/v1`,
  },
});
store.setSecret('default', 'OPENAI_API_KEY', 'synthetic-vault-provider');
const unlockProof = path.join(root, 'unlock-proof.json');
const fakeBw = path.join(root, 'bw-fixture');
fs.writeFileSync(
  fakeBw,
  `#!${process.execPath}\nconst fs=require('node:fs');\nif(process.argv[2]==='unlock'){fs.writeFileSync(${JSON.stringify(unlockProof)},JSON.stringify({correct:process.env.HERMES_BW_MASTER==='synthetic-master-7334',argvHasSecret:process.argv.some(a=>a.includes('synthetic-master')),modelKeyPresent:!!process.env.OPENAI_API_KEY}));console.log('synthetic-session-token');}else console.log('[]');`,
  { mode: 0o700 },
);
const configPath = path.join(store.home('default'), 'config.yaml');
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
config.browser = {
  ...config.browser,
  cdp_url: `http://127.0.0.1:${cdpPort}`,
  allow_private_urls: true,
};
config.vault = { bitwarden: { binary_path: fakeBw } };
store.atomic(configPath, YAML.stringify(config));
const backend = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, TEAMMATES_DATA_DIR: root, PORT: String(appPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostic = '';
backend.stderr.on('data', (c) => {
  diagnostic += String(c);
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const url = `http://127.0.0.1:${appPort}`;
const password = 'synthetic-private-login-7368';
const code = '743982';
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 30000);
    backend.stdout.on('data', (c) => {
      if (String(c).includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    backend.once('error', reject);
  });
  await page.goto(url);
  await expect
    .poll(
      async () => (await (await page.request.get(`${url}/api/state`)).json()).runtime.available,
      { timeout: 30000 },
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Show Bot details', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Show Bot details', exact: true }).click();
  await page.getByRole('button', { name: /Credentials .*saved/ }).click();
  await page.getByRole('button', { name: 'Add login', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Login label').fill('Project account');
  await dialog.getByLabel('Website URL').fill('https://example.test/account');
  await dialog.getByLabel('Email, username or phone').fill('owner@example.test');
  expect(await dialog.getByLabel('Password', { exact: true }).getAttribute('type')).toBe(
    'password',
  );
  await dialog.getByLabel('Password', { exact: true }).fill('synthetic-settings-password');
  await dialog.getByRole('button', { name: 'Save login', exact: true }).click();
  await expect(page.locator('.vault-item')).toContainText('Project account');
  await page.reload();
  await page.getByRole('button', { name: 'Show Bot details', exact: true }).click();
  await page.getByRole('button', { name: /Credentials .*saved/ }).click();
  await expect(page.locator('.vault-item')).toContainText('Project account');
  expect(await page.locator('body').innerText()).not.toContain('synthetic-settings-password');
  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/login-vault.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove login Project account' }).click();
  await dialog.getByRole('button', { name: 'Remove login', exact: true }).click();
  await expect(page.locator('.vault-item')).toHaveCount(0);
  async function send(marker: string) {
    await page.getByLabel('Message', { exact: true }).fill(marker);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  }
  await send('VAULT_LOGIN: privately save this website login, then enter the verification code.');
  const login = page.getByRole('region', { name: 'Hermes login request', exact: true });
  await expect(login).toBeVisible({ timeout: 45000 });
  await page.reload();
  await expect(login).toBeVisible({ timeout: 15000 });
  expect(await login.getByLabel('Password', { exact: true }).getAttribute('type')).toBe('password');
  await login.getByLabel('Email, username or phone').fill('owner@example.test');
  await login.getByLabel('Password', { exact: true }).fill(password);
  await expect(page.getByText('Loading conversation…', { exact: true })).toBeHidden({
    timeout: 15000,
  });
  await page.screenshot({ path: 'test-artifacts/private-login-request.png', fullPage: true });
  const state = await (await page.request.get(url + '/api/state')).json();
  const request = state.requests.find((r: { kind: string }) => r.kind === 'vault_login');
  const wrong = await page.request.post(`${url}/api/bots/default/requests/${request.id}`, {
    data: { kind: 'vault_code', value: 'wrong-kind' },
  });
  expect(wrong.status()).toBe(500);
  await expect(login).toBeVisible();
  await login.getByRole('button', { name: 'Save & fill', exact: true }).click();
  const otp = page.getByRole('region', { name: 'Hermes verification code request', exact: true });
  await expect(otp).toBeVisible({ timeout: 25000 });
  // Native Chrome may create a separate context. Find the actual controlled login target.
  await expect
    .poll(async () => {
      const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      try {
        return await cdp
          .contexts()[0]
          .pages()
          .find((p) => p.url().endsWith('/login'))
          ?.locator('input[name=password]')
          .inputValue();
      } finally {
        await cdp.close();
      }
    })
    .toBe(password);
  expect(await otp.getByLabel('Verification code', { exact: true }).getAttribute('type')).toBe(
    'password',
  );
  await otp.getByLabel('Verification code', { exact: true }).fill(code);
  await otp.getByRole('button', { name: 'Use code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 25000,
  });
  const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const p = cdp
      .contexts()[0]
      .pages()
      .find((p) => p.url().endsWith('/login'));
    expect(await p?.locator('input[name=otp]').inputValue()).toBe(code);
  } finally {
    await cdp.close();
  }
  await send('VAULT_UNLOCK: unlock Bitwarden privately.');
  const unlock = page.getByRole('region', { name: 'Hermes vault unlock request', exact: true });
  await expect(unlock).toBeVisible({ timeout: 35000 });
  await unlock.getByLabel('Master password', { exact: true }).fill('synthetic-master-7334');
  await unlock.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 25000,
  });
  expect(JSON.parse(fs.readFileSync(unlockProof, 'utf8'))).toEqual({
    correct: true,
    argvHasSecret: false,
    modelKeyPresent: false,
  });
  let vault = await (await page.request.get(url + '/api/bots/default/vault')).json();
  expect(vault.sources.find((s: { name: string }) => s.name === 'bitwarden').unlocked).toBe(true);
  await page.request.post(url + '/api/bots/default/vault/lock', { data: {} });
  vault = await (await page.request.get(url + '/api/bots/default/vault')).json();
  expect(vault.sources.find((s: { name: string }) => s.name === 'bitwarden').unlocked).toBe(false);
  await send('VAULT_SKIP: decline saving this website login.');
  await expect(login).toBeVisible({ timeout: 35000 });
  await login.getByRole('button', { name: 'Don’t save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
    timeout: 25000,
  });
  await send('VAULT_STOP: start another private login request.');
  await expect(login).toBeVisible({ timeout: 35000 });
  await page.getByRole('button', { name: 'Stop Bot', exact: true }).click();
  await expect(login).toBeHidden({ timeout: 10000 });
  const exposed =
    JSON.stringify(fixture.received) +
    JSON.stringify(await (await page.request.get(url + '/api/state')).json()) +
    JSON.stringify(await (await page.request.get(url + '/api/bots/default')).json()) +
    fs.readFileSync(path.join(root, 'teammates.json'), 'utf8');
  for (const secret of [password, code, 'synthetic-master-7334', 'synthetic-session-token'])
    expect(exposed).not.toContain(secret);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
      await expect(
        window.getByRole('button', { name: 'Show Bot details', exact: true }),
      ).toBeVisible({
        timeout: 30000,
      });
      await window
        .getByLabel('Message', { exact: true })
        .fill('VAULT_DESKTOP: save the login privately.');
      await window.getByRole('button', { name: 'Send message', exact: true }).click();
      const card = window.getByRole('region', { name: 'Hermes login request', exact: true });
      await expect(card).toBeVisible({ timeout: 40000 });
      await card.getByLabel('Email, username or phone').fill('desktop@example.test');
      await card.getByLabel('Password', { exact: true }).fill('synthetic-desktop-password');
      await card.getByRole('button', { name: 'Save & fill', exact: true }).click();
      await expect(window.getByRole('button', { name: 'Stop Bot', exact: true })).toHaveCount(0, {
        timeout: 25000,
      });
      const connected = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      try {
        expect(
          await connected
            .contexts()[0]
            .pages()
            .find((p) => p.url().endsWith('/login'))
            ?.locator('input[name=password]')
            .inputValue(),
        ).toBe('synthetic-desktop-password');
      } finally {
        await connected.close();
      }
      expect(fixture.received.join('')).not.toContain('synthetic-desktop-password');
      console.log(
        'Packaged Electron private login reached the native encrypted vault and actual browser field.',
      );
    } finally {
      await desktop.close();
    }
  }
  console.log(
    'Compiled vault settings, native private login/code fill, manager unlock/lock, reload, mismatched reply, Stop, privacy and 390px layout passed. Manager CLI and model transport are controlled fixtures.',
  );
} catch (error) {
  console.error('Recent native diagnostics:', diagnostic.slice(-2500));
  console.error(
    'Last native tool results:',
    JSON.parse(fixture.received.at(-1) || '{}').messages?.filter(
      (m: { role: string }) => m.role === 'tool',
    ),
  );
  throw error;
} finally {
  await browser.close();
  await target.close();
  if (backend.exitCode === null && backend.signalCode === null)
    await new Promise<void>((r) => {
      backend.once('exit', () => r());
      backend.kill('SIGTERM');
    });
  await new Promise<void>((r) => fixture.server.close(() => r()));
  // Native agent-browser daemons detach from the gateway. Reap only fixture-owned
  // processes, identified by their working directory, before deleting the root.
  const owners = spawnSync('lsof', ['-a', '-c', 'agent-browser', '-d', 'cwd', '-Fpn'], {
    encoding: 'utf8',
  });
  let ownerPid: number | undefined;
  const ownedRoot = fs.realpathSync(root) + path.sep;
  for (const line of (owners.stdout || '').split('\n')) {
    if (line.startsWith('p')) ownerPid = Number(line.slice(1));
    else if (line.startsWith('n' + ownedRoot) && ownerPid) {
      try {
        process.kill(ownerPid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}
