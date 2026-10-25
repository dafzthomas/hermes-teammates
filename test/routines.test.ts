import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store';
import { createApp } from '../server/index';
import { createMobileGateway, mobileRoute } from '../server/mobile';
import { routineSchema, type Routine, type RoutinePreference } from '../src/domain';
import { parseRoutineOutput } from '../server/routine-output';

function routine(store: Store, id: string, botId = 'default'): Routine {
  return routineSchema.parse({
    id,
    name: 'Same name',
    prompt: 'Check.',
    deliver: 'bot-chat',
    workdir: fs.realpathSync(path.join(store.home(botId), 'workspace')),
  });
}
function chosen(job: Routine, preference: RoutinePreference): Routine {
  return {
    ...job,
    deliver: preference === 'all' ? 'bot-chat' : 'local',
    failure_deliver: preference === 'never' ? 'local' : 'bot-chat',
    teammates_update_preference: { version: 1, preference },
  };
}
function output(
  store: Store,
  routineId: string,
  response: string,
  name = '2026-10-25_12-00-00.md',
) {
  const file = path.join(store.home('default'), 'cron', 'output', routineId, name);
  const content = `# Cron Job: Same name\n\n**Job ID:** ${routineId}\n**Run Time:** 2026-10-25 12:00:00\n**Schedule:** hourly\n\n## Prompt\n\nPrivate routine instructions.\n\n## Response\n\n${response}\n`;
  store.atomic(file, content);
  return content;
}

test('routine choices are per ID and Bot, persistent, recoverable and use native routing as authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-store-'));
  try {
    const store = new Store(root);
    const a = routine(store, 'a');
    const b = routine(store, 'b');
    const other = store.createBot({ ...store.bot('default'), name: 'Other' });
    store.setSecret('default', 'TEST_KEY', 'private-result-token');
    assert.equal(store.routineDetails('default', [a]).routines[0].updatePrompt, null);
    output(store, 'a', '[SILENT] Nothing changed');
    assert.equal(store.routineDetails('default', [a]).routines[0].updatePrompt, null);
    output(store, 'a', 'Useful private-result-token', '2026-10-25_13-00-00.md');
    output(store, 'b', 'Different routine with same name');
    const first = store.routineDetails('default', [a, b]);
    const prompt = first.routines[0].updatePrompt;
    assert.ok(prompt);
    assert.equal(
      first.routineOutputs.find((o) => o.outcome === 'result' && o.routineId === 'a')?.response,
      'Useful [redacted]',
    );
    assert.deepEqual(
      new Store(root).routineDetails('default', [a]).routines[0].updatePrompt,
      prompt,
    );
    store.setRoutinePreference('default', 'a', 'never');
    output(store, 'a', '[CRON_FAILURE]\nSomething broke', '2026-10-25_14-00-00.md');
    const reopened = new Store(root);
    const never = reopened.routineDetails('default', [chosen(a, 'never'), b]);
    assert.equal(never.routines[0].updatePrompt, null);
    assert.equal(never.routines[0].updatePreference, 'never');
    assert.ok(
      never.routineOutputs
        .filter((o) => o.routineId === 'a')
        .every((o) => o.visibility === 'suppressed'),
    );
    assert.equal(never.routineOutputs.find((o) => o.routineId === 'b')?.visibility, 'shown');
    assert.equal(
      reopened.routineDetails(other.id, [routine(reopened, 'a', other.id)]).routines[0]
        .updatePreference,
      null,
    );
    const errors = reopened.routineDetails('default', [chosen(a, 'errors')]);
    assert.equal(errors.routineOutputs.find((o) => o.outcome === 'error')?.visibility, 'shown');
    assert.equal(
      errors.routineOutputs.find((o) => o.routineId === 'a' && o.outcome === 'result')?.visibility,
      'suppressed',
    );
    assert.equal(
      reopened
        .routineDetails('default', [chosen(a, 'all')])
        .routineOutputs.find((o) => o.routineId === 'a' && o.outcome === 'result')?.visibility,
      'shown',
    );
    const drifted = { ...chosen(a, 'never'), deliver: 'telegram:123' };
    assert.equal(
      reopened.routineDetails('default', [drifted]).routines[0].updatePreferenceAvailable,
      false,
    );
    assert.equal(reopened.routineDetails('default', [drifted]).routines[0].updatePreference, null);
    assert.equal(fs.statSync(reopened.statePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native output envelopes reject wrong IDs and ambiguous sections without exposing prompts as responses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-output-'));
  try {
    const store = new Store(root);
    const raw = output(store, 'a', 'Useful result');
    assert.deepEqual(parseRoutineOutput(raw, 'a'), {
      outcome: 'result',
      response: 'Useful result',
    });
    assert.deepEqual(parseRoutineOutput(raw, 'b'), { outcome: 'unknown', response: null });
    const failedWithQuotedResponse = raw
      .replace('# Cron Job: Same name', '# Cron Job: Same name (FAILED)')
      .replace('Private routine instructions.', '## Response\n\nQuoted instructions')
      .replace(
        '## Response\n\nUseful result',
        '## Error\n\n```\nRuntimeError: Native traceback\n```',
      );
    assert.deepEqual(parseRoutineOutput(failedWithQuotedResponse, 'a'), {
      outcome: 'error',
      response: null,
    });
    assert.deepEqual(
      parseRoutineOutput(
        raw.replace('Private routine instructions.', '## Response\n\nInjected'),
        'a',
      ),
      { outcome: 'unknown', response: null },
    );
    assert.deepEqual(parseRoutineOutput('User copied a [Cronjob banner] and [SILENT]', 'a'), {
      outcome: 'unknown',
      response: null,
    });
    for (const rawWithHeading of [
      raw.replace(
        'Private routine instructions.',
        'Include this section:\n\n## Error\n\nDescribe any errors.',
      ),
      raw.replace('Useful result', 'Useful result\n\n## Error\n\nNo errors occurred.'),
    ]) {
      const response = rawWithHeading.split('\n\n## Response\n\n')[1].trim();
      assert.deepEqual(parseRoutineOutput(rawWithHeading, 'a'), { outcome: 'result', response });
      store.atomic(
        path.join(store.home('default'), 'cron', 'output', 'a', '2026-10-25_12-00-00.md'),
        rawWithHeading,
      );
      assert.ok(store.routineDetails('default', [routine(store, 'a')]).routines[0].updatePrompt);
      assert.equal(
        store.routineDetails('default', [chosen(routine(store, 'a'), 'errors')]).routineOutputs[0]
          .visibility,
        'suppressed',
      );
    }
    assert.deepEqual(
      parseRoutineOutput(
        failedWithQuotedResponse.replace(
          '```\nRuntimeError: Native traceback\n```',
          'Native traceback',
        ),
        'a',
      ),
      { outcome: 'unknown', response: null },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonical private history and read cursors preserve legacy sessions, user messages and group isolation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-history-'));
  const store = new Store(root);
  const db = new DatabaseSync(path.join(store.home('default'), 'state.db'));
  try {
    db.exec(`CREATE TABLE sessions(id TEXT,title TEXT,source TEXT,hidden INTEGER DEFAULT 0,started_at REAL,message_count INTEGER DEFAULT 0);
      CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INTEGER DEFAULT 1,tool_name TEXT);
      INSERT INTO sessions(id,title,source,started_at) VALUES ('main','Bot Chat','cli',1),('old','Research','cli',2),('compressed','Research #2','cli',3),('group','Group removed-group','cli',4),('cron','Routine internals','cron',5),('untitled',NULL,'cli',6);
      INSERT INTO messages VALUES (1,'main','user','[Cronjob fake] User text',1,1,NULL),(2,'main','assistant','Main reply',2,1,NULL),(3,'old','assistant','Old reply',3,1,NULL),(4,'compressed','assistant','Later reply',4,1,NULL),(5,'group','assistant','Private group',5,1,NULL),(6,'cron','assistant','Internal routine',6,1,NULL),(7,'untitled','assistant','Untitled reply',7,1,NULL);`);
    assert.deepEqual(
      store.history('default').messages.map((m) => m.id),
      ['main:1', 'main:2'],
    );
    assert.deepEqual(
      store.history('default', 'Bot Chat', true).messages.map((m) => m.id),
      ['main:1', 'main:2', 'old:3', 'compressed:4', 'untitled:7'],
    );
    assert.equal(store.inbox(true).conversations[0].unread, 4);
    store.acknowledge('default', 'Bot Chat', 'compressed:4', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 1);
    assert.equal(store.inbox().conversations.find((c) => c.title === 'Bot Chat')?.unread, 1);
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'group:5', true));
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'cron:6', true));
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'main:1', true));
    assert.equal(store.history('default', 'Research').messages.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count, 7);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonical receipts and previews follow displayed chronology across restored sessions and reloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-order-'));
  const store = new Store(root);
  const db = new DatabaseSync(path.join(store.home('default'), 'state.db'));
  try {
    db.exec(`CREATE TABLE sessions(id TEXT,title TEXT,source TEXT,hidden INTEGER DEFAULT 0,started_at REAL,message_count INTEGER DEFAULT 0);
      CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INTEGER DEFAULT 1,tool_name TEXT);
      INSERT INTO sessions(id,title,source,started_at) VALUES ('main','Bot Chat','cli',1),('restored','Research','cli',2),('group','Group removed-group','cli',3),('cron','Routine','cron',4);
      INSERT INTO messages VALUES (10,'main','assistant','Latest chronological reply',200,1,NULL),(20,'restored','assistant','Restored older reply',100,1,NULL),(30,'group','assistant','Group reply',300,1,NULL),(40,'cron','assistant','Cron reply',400,1,NULL);`);
    assert.deepEqual(
      store.history('default', 'Bot Chat', true).messages.map((m) => m.id),
      ['restored:20', 'main:10'],
    );
    assert.equal(store.inbox(true).conversations[0].latestId, 'main:10');
    store.acknowledge('default', 'Bot Chat', 'restored:20', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 1);
    store.acknowledge('default', 'Bot Chat', 'main:10', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 0);
    store.acknowledge('default', 'Bot Chat', 'restored:20', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 0);
    assert.equal(store.inbox().conversations.find((c) => c.title === 'Bot Chat')?.unread, 1);
    assert.equal(store.inbox().conversations.find((c) => c.title === 'Research')?.unread, 1);
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'group:30', true));
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'cron:40', true));
    db.exec(
      "INSERT INTO messages VALUES (5,'restored','assistant','New timestamp with lower ID',250,1,NULL),(15,'main','assistant','Equal timestamp with higher ID',250,1,NULL)",
    );
    assert.equal(store.inbox(true).conversations[0].unread, 2);
    store.acknowledge('default', 'Bot Chat', 'restored:5', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 1);
    store.acknowledge('default', 'Bot Chat', 'main:15', true);
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 0);
    const cursor = store.state.readCursors.find((c) => c.canonical)!;
    delete cursor.timestamp;
    store.save();
    assert.equal(new Store(root).inbox(true).conversations[0].unread, 0);
    store.acknowledge('default', 'Bot Chat', 'main:10');
    assert.equal(store.inbox().conversations.find((c) => c.title === 'Bot Chat')?.unread, 1);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated mobile preference API persists only after native success and validates ownership', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-api-'));
  const context = createApp(root);
  let job = routine(context.store, 'a');
  let fail = false;
  let updates = 0;
  context.hermes.routines = async (_id, action, args) => {
    if (action === 'list') return [job];
    assert.equal(action, 'preference');
    updates++;
    if (fail) throw new Error('Active run owns this routine');
    job = chosen(job, args!.preference as RoutinePreference);
    return job;
  };
  const local = context.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => local.once('listening', resolve));
  const localAddress = local.address();
  assert.ok(localAddress && typeof localAddress !== 'string');
  const gateway = http.createServer(
    createMobileGateway(
      context.mobile,
      `http://127.0.0.1:${localAddress.port}`,
      'https://phone.example',
    ),
  );
  gateway.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => gateway.once('listening', resolve));
  const address = gateway.address();
  assert.ok(address && typeof address !== 'string');
  const access = context.mobile.pair(context.mobile.createPairing().code, 'Fixture phone')!;
  const request = (id: string, body: unknown, authenticated = true) =>
    new Promise<{ status: number; json: () => Promise<Record<string, unknown>> }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: `/api/bots/default/routines/${id}/preference`,
            method: 'PUT',
            headers: {
              Host: 'phone.example',
              'Content-Type': 'application/json',
              ...(authenticated ? { Authorization: `Bearer ${access.token}` } : {}),
            },
          },
          (res) => {
            let raw = '';
            res.on('data', (chunk) => {
              raw += String(chunk);
            });
            res.on('end', () =>
              resolve({ status: res.statusCode!, json: async () => JSON.parse(raw) }),
            );
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
      },
    );
  try {
    assert.equal((await request('a', { preference: 'never' }, false)).status, 401);
    assert.equal((await request('missing', { preference: 'never' })).status, 404);
    assert.equal((await request('a', { preference: 'invented' })).status, 400);
    assert.equal(updates, 0);
    const saved = await request('a', { preference: 'never' });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).updatePreference, 'never');
    assert.equal(new Store(root).state.routinePreferences[0].preference, 'never');
    fail = true;
    assert.equal((await request('a', { preference: 'all' })).status, 409);
    assert.equal(new Store(root).state.routinePreferences[0].preference, 'never');
    assert.ok(mobileRoute('PUT', '/api/bots/default/routines/a/preference'));
    for (const route of [
      '/api/bots/default/routines/a/delivery',
      '/api/bots/default/routines/a/preference/extra',
      '/api/bots/default/routines/a%2fb/preference',
    ])
      assert.equal(mobileRoute('PUT', route), false);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await new Promise<void>((resolve) => local.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
