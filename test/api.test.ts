import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/index';

test('Loopback API blocks browser-origin writes and never returns credential values', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-api-'));
  const context = createApp(root);
  const server = context.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const blocked = await fetch(`${url}/api/bots/default/secrets/TEST_KEY`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ value: 'secret-value' }),
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(context.store.secretEntries('default'), {});
    const saved = await fetch(`${url}/api/bots/default/secrets/TEST_KEY`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'secret-value' }),
    });
    assert.equal(saved.status, 200);
    assert.ok(!(await saved.text()).includes('secret-value'));
    assert.ok(!(await (await fetch(`${url}/api/state`)).text()).includes('secret-value'));
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.get(
        `${url}/api/state`,
        { headers: { Host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
    });
    assert.equal(hostStatus, 403);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
