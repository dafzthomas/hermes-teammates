import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MobileAccess, createMobileGateway, mobileRoute } from '../server/mobile';
import { createApp } from '../server/index';

test('pairing codes are one-use and expiring; device hashes persist, expire and revoke', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-access-'));
  let time = Date.now();
  try {
    const access = new MobileAccess(root, () => time);
    const first = access.createPairing();
    assert.equal(access.pair('wrong', 'Phone'), null);
    const newer = access.createPairing();
    assert.equal(access.pair(first.code, 'Phone'), null);
    const paired = access.pair(newer.code, 'Phone')!;
    assert.ok(paired);
    assert.equal(access.pair(newer.code, 'Other'), null);
    const disk = fs.readFileSync(access.file, 'utf8');
    assert.ok(!disk.includes(paired.token));
    assert.ok(!disk.includes(newer.code));
    assert.equal(fs.statSync(access.file).mode & 0o777, 0o600);
    assert.equal(access.authenticate(`Bearer ${paired.token}`)?.name, 'Phone');
    assert.equal(access.authenticate(`Bearer ${paired.token}junk`), undefined);
    const restored = new MobileAccess(root, () => time);
    assert.ok(restored.authenticate(`Bearer ${paired.token}`));
    restored.revoke(paired.deviceId);
    assert.equal(new MobileAccess(root).authenticate(`Bearer ${paired.token}`), undefined);
    const expiredCode = access.createPairing();
    time += 300_001;
    assert.equal(access.pair(expiredCode.code, 'Late'), null);
    time = paired.expiresAt;
    assert.equal(access.authenticate(`Bearer ${paired.token}`), undefined);
    assert.ok(!JSON.stringify(access.list()).includes('hash'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mobile gateway rejects unauthenticated requests, foreign hosts/origins and internal routes; proxies actual backend', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gateway-'));
  const context = createApp(root);
  const local = context.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => local.once('listening', resolve));
  const address = local.address();
  assert.ok(address && typeof address !== 'string');
  const gateway = http.createServer(
    createMobileGateway(
      context.mobile,
      `http://127.0.0.1:${address.port}`,
      'https://phone.example:4311',
    ),
  );
  gateway.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => gateway.once('listening', resolve));
  const remote = gateway.address();
  assert.ok(remote && typeof remote !== 'string');
  async function request(
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Promise<{
      status: number;
      headers: Map<string, string>;
      json: () => Promise<unknown>;
    }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: (remote as { port: number }).port,
          path: route,
          method,
          headers: { Host: 'phone.example:4311', 'Content-Type': 'application/json', ...headers },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += String(chunk);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              headers: new Map(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
              json: async () => JSON.parse(raw) as unknown,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  try {
    assert.equal((await request('/api/state')).status, 401);
    assert.equal(
      (
        await request(
          '/mobile/pair',
          'POST',
          { code: 'bad', name: 'Phone' },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/api/state', 'GET', undefined, { Host: 'evil.example' })).status,
      403,
    );
    const pairing = context.mobile.createPairing();
    const pairedResponse = await request('/mobile/pair', 'POST', {
      code: pairing.code,
      name: 'Phone',
    });
    assert.equal(pairedResponse.status, 200);
    const paired = (await pairedResponse.json()) as { token: string; deviceId: string };
    const auth = { Authorization: `Bearer ${paired.token}` };
    assert.equal(
      (await request('/mobile/pair', 'POST', { code: pairing.code, name: 'Other' })).status,
      401,
    );
    const state = await request('/api/state', 'GET', undefined, auth);
    assert.equal(state.status, 200);
    assert.ok(state.headers.get('cache-control')?.includes('no-store'));
    const snapshot = (await state.json()) as { bots: { id: string }[] };
    assert.ok(snapshot.bots.some((b) => b.id === 'default'));
    const created = await request(
      '/api/bots',
      'POST',
      {
        name: 'Mobile Bot',
        role: 'Mobile test',
        provider: { kind: 'compatible', model: 'test', baseUrl: 'http://localhost:11434/v1' },
      },
      auth,
    );
    assert.equal(created.status, 201);
    for (const route of [
      '/api/mobile/pairings',
      '/api/mobile/devices',
      '/api/bots/default/computer/wake',
      '/api/bots/default/computer-tools/shell',
      '/api/bots/default/action-review',
      '/api/events',
      '/api/bots/default/vault/logins',
    ])
      assert.equal((await request(route, 'POST', {}, auth)).status, 404, route);
    assert.equal(
      (await request('/api/state', 'GET', undefined, { ...auth, Origin: 'capacitor://localhost' }))
        .status,
      403,
    );
    // The original desktop checks still reject remote browser headers.
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${address.port}/api/state`, {
          headers: { Origin: 'https://phone.example:4311' },
        })
      ).status,
      403,
    );
    assert.equal((await request('/mobile/device', 'DELETE', undefined, auth)).status, 200);
    assert.equal((await request('/api/state', 'GET', undefined, auth)).status, 401);
    for (let i = 0; i < 8; i++)
      await request('/mobile/pair', 'POST', { code: 'invalid', name: 'Phone' });
    assert.equal(
      (await request('/mobile/pair', 'POST', { code: 'invalid', name: 'Phone' })).status,
      429,
    );
    assert.ok(!JSON.stringify(context.store.state).includes(paired.token));
    assert.equal(mobileRoute('GET', '/api/bots/default%2fcomputer'), false);
    assert.equal(mobileRoute('POST', '/api/bots/default/requests/request-1'), true);
    assert.equal(mobileRoute('GET', '//evil.example/api/state'), false);
  } finally {
    await context.close();
    await Promise.all([
      new Promise<void>((r) => local.close(() => r())),
      new Promise<void>((r) => gateway.close(() => r())),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mobile host input requires a single HTTPS origin without embedded credentials or routing', async () => {
  const { hostOrigin } = await import('../mobile/src/connection');
  assert.equal(hostOrigin(' https://host.example:4311/ '), 'https://host.example:4311');
  for (const url of [
    'http://host.example',
    'https://user:pass@host.example',
    'https://host.example/path',
    'https://host.example/?token=private',
    'https://host.example/#token',
    'file:///tmp/host',
  ])
    assert.throws(() => hostOrigin(url));
});
