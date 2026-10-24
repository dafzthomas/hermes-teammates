import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import YAML from 'yaml';
import { createApp } from '../server/index';
import { vaultSnapshotSchema } from '../src/vault';

const installed = fs.existsSync(
  process.env.HERMES_EXECUTABLE || path.join(os.homedir(), '.local/bin/hermes'),
);
test(
  'Native encrypted login vault persists, isolates profiles and exposes metadata only',
  { skip: !installed, timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-vault-'));
    const app = createApp(root);
    const server = http.createServer(app.app);
    server.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/bots/`;
    async function api(endpoint: string, body?: unknown, method = body ? 'POST' : 'GET') {
      const res = await fetch(url + endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() };
    }
    const password = 'synthetic-vault-password-5492';
    const otpSecret = 'JBSWY3DPEHPK3PXP';
    try {
      await app.hermes.probe();
      assert.ok(app.hermes.runtime.available);
      const other = app.store.createBot({
        name: 'Separate vault',
        role: 'Separate',
        color: 'green',
        provider: app.store.bot('default').provider,
      });
      const added = await api('default/vault/logins', {
        label: 'Fixture login',
        origin: 'https://example.test/account',
        identifier: 'owner@example.test',
        identifierType: 'email',
        password,
        otpSecret,
      });
      assert.equal(added.status, 201, JSON.stringify(added.body));
      let snapshot = await api('default/vault');
      assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
      const parsed = vaultSnapshotSchema.parse(snapshot.body);
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].origin, 'https://example.test');
      assert.equal(parsed.items[0].has_otp, true);
      assert.doesNotMatch(JSON.stringify(snapshot.body), new RegExp(password + '|' + otpSecret));
      assert.deepEqual(vaultSnapshotSchema.parse((await api(other.id + '/vault')).body).items, []);
      assert.deepEqual(
        (await api(other.id + '/vault/logins/' + added.body.id, undefined, 'DELETE')).body,
        { removed: false },
      );
      const vaultDir = path.join(app.store.home('default'), 'vault');
      for (const filename of ['vault.json.enc', 'vault.key']) {
        const filenamePath = path.join(vaultDir, filename);
        assert.equal(fs.statSync(filenamePath).mode & 0o777, 0o600);
        assert.doesNotMatch(
          fs.readFileSync(filenamePath, 'utf8'),
          new RegExp(password + '|' + otpSecret),
        );
      }
      app.hermes.reset('default');
      snapshot = await api('default/vault');
      assert.equal(snapshot.body.items[0].id, added.body.id);
      assert.equal(
        (
          await api('default/vault/logins', {
            label: 'Bad',
            origin: 'https://user:pass@example.test',
            identifier: 'user',
            password,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await api('default/vault/logins', {
            label: 'Bad URL',
            origin: 'not-a-url',
            identifier: 'user',
            password,
          })
        ).status,
        400,
      );
      const invalid = await api('default/vault/logins', {
        label: 'Bad OTP',
        origin: 'https://example.test',
        identifier: 'user',
        password,
        otpSecret: 'invalid synthetic secret!',
      });
      assert.equal(invalid.status, 500);
      assert.doesNotMatch(
        JSON.stringify(invalid.body),
        /invalid synthetic secret|synthetic-vault-password/,
      );
      assert.equal(
        (await api('default/vault/sources/bitwarden', { enabled: false }, 'PUT')).status,
        200,
      );
      const cfg = YAML.parse(
        fs.readFileSync(path.join(app.store.home('default'), 'config.yaml'), 'utf8'),
      );
      assert.equal(cfg.vault.bitwarden.enabled, false);
      const otherConfig = YAML.parse(
        fs.readFileSync(path.join(app.store.home(other.id), 'config.yaml'), 'utf8'),
      );
      assert.notEqual(otherConfig.vault?.bitwarden?.enabled, false);
      assert.deepEqual(
        (await api('default/vault/logins/' + added.body.id, undefined, 'DELETE')).body,
        { removed: true },
      );
      assert.equal((await api('default/vault')).body.items.length, 0);
      assert.doesNotMatch(JSON.stringify(app.store.state), new RegExp(password + '|' + otpSecret));
    } finally {
      await app.close();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
