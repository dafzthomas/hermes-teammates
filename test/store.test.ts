import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store';
import { childEnvironment } from '../server/hermes';
import YAML from 'yaml';

test('Bot credentials, memory and files stay separate and survive reopening', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-store-'));
  try {
    const store = new Store(root);
    const bot = store.createBot({
      name: 'Researcher',
      role: 'Find sources.',
      color: 'violet',
      provider: { kind: 'compatible', model: 'test', baseUrl: 'http://127.0.0.1:11434/v1' },
    });
    store.setSecret(bot.id, 'TEST_KEY', 'private-test-value');
    store.saveMemory(bot.id, 'MEMORY', 'Only Researcher should know this.');
    store.atomic(store.safeFile(bot.id, 'workspace', 'brief.md'), '# Private brief');
    const reopened = new Store(root);
    assert.equal(reopened.memory('default', 'MEMORY'), '');
    assert.deepEqual(reopened.secretEntries('default'), {});
    assert.equal(reopened.memory(bot.id, 'MEMORY'), 'Only Researcher should know this.');
    assert.equal(reopened.secretEntries(bot.id).TEST_KEY, 'private-test-value');
    assert.deepEqual(reopened.files('default'), []);
    assert.equal(reopened.redact(bot.id, 'key is private-test-value'), 'key is [redacted]');
    assert.equal(fs.statSync(path.join(reopened.home(bot.id), '.env')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('File API rejects traversal, symlinks and runtime-control credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-boundary-'));
  try {
    const store = new Store(root);
    for (const name of ['../config.yaml', '..', '/etc/passwd', 'nested/file'])
      assert.throws(() => store.safeFile('default', 'workspace', name));
    fs.symlinkSync(
      path.join(root, 'outside'),
      path.join(store.home('default'), 'workspace', 'link.txt'),
    );
    assert.throws(() => store.safeFile('default', 'workspace', 'link.txt'));
    for (const name of ['HERMES_HOME', 'PATH', 'NODE_OPTIONS', 'PYTHONPATH'])
      assert.throws(() => store.setSecret('default', name, 'bad'));
    process.env.TEAMMATES_TEST_SECRET = 'do-not-inherit';
    assert.equal(childEnvironment(root).TEAMMATES_TEST_SECRET, undefined);
    delete process.env.TEAMMATES_TEST_SECRET;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Editing a Bot preserves native integrations and independent runtime settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-config-'));
  try {
    const store = new Store(root);
    const file = path.join(store.home('default'), 'config.yaml');
    const config = YAML.parse(fs.readFileSync(file, 'utf8'));
    config.mcp_servers = { research: { command: 'example-server' } };
    config.terminal.timeout = 90;
    fs.writeFileSync(file, YAML.stringify(config));
    store.updateBot('default', { ...store.bot('default'), name: 'Coordinator' });
    const updated = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(updated.mcp_servers.research.command, 'example-server');
    assert.equal(updated.terminal.timeout, 90);
    assert.equal(updated.approvals.single_query_mode, 'deny');
    assert.equal(childEnvironment(root).HERMES_DISABLE_LAZY_INSTALLS, '1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
