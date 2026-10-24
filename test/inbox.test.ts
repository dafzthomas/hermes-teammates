import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store';

function database(store: Store, id: string) {
  const db = new DatabaseSync(path.join(store.home(id), 'state.db'));
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY,title TEXT,source TEXT,hidden INTEGER DEFAULT 0,started_at REAL,message_count INTEGER DEFAULT 0);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INTEGER DEFAULT 1,tool_name TEXT);
    INSERT INTO sessions (id,title,source,started_at) VALUES ('main','Bot Chat','cli',1),('thread','Research','cli',2),('compressed','Bot Chat #2','cli',3),('cron','Scheduled proof','cron',4);
    INSERT INTO sessions (id,title,source,hidden,started_at) VALUES ('hidden','Bot Chat','cli',1,5);`);
  return db;
}

test('Unread cursors preserve later replies, separate threads and Bots, and survive restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-inbox-'));
  const store = new Store(root);
  const other = store.createBot({ ...store.bot('default'), name: 'Other' });
  const db = database(store, 'default');
  const second = database(store, other.id);
  const reply = db.prepare(
    'INSERT INTO messages (session_id,role,content,timestamp) VALUES (?,?,?,?)',
  );
  try {
    store.setSecret('default', 'TEST_KEY', 'private-inbox-key');
    reply.run('main', 'user', 'My message', 1);
    reply.run('main', 'assistant', 'First reply private-inbox-key', 2);
    reply.run('thread', 'assistant', 'Thread reply', 3);
    reply.run('cron', 'assistant', 'Routine execution internals', 4);
    reply.run('hidden', 'assistant', 'Hidden reply', 5);
    reply.run('main', 'tool', 'Tool result', 6);
    reply.run('main', 'assistant', '', 7);
    second
      .prepare(
        "INSERT INTO messages (session_id,role,content,timestamp) VALUES ('main','assistant','Other Bot',1)",
      )
      .run();
    let inbox = store.inbox();
    assert.equal(inbox.conversations.length, 3);
    assert.equal(
      inbox.conversations.find((c) => c.botId === 'default' && c.title === 'Bot Chat')?.unread,
      1,
    );
    assert.match(
      inbox.conversations.find((c) => c.botId === 'default' && c.title === 'Bot Chat')?.preview ||
        '',
      /\[redacted\]/,
    );
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'thread:3'));
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'hidden:5'));
    assert.throws(() => store.acknowledge('default', 'Bot Chat', 'main:99999'));
    assert.throws(() => store.acknowledge(other.id, 'Bot Chat', 'main:2'));
    // A reply arrives after the client observed message 2, before its read acknowledgement.
    reply.run('compressed', 'assistant', 'Later reply', 8);
    store.acknowledge('default', 'Bot Chat', 'main:2');
    inbox = new Store(root).inbox();
    assert.equal(
      inbox.conversations.find((c) => c.botId === 'default' && c.title === 'Bot Chat')?.unread,
      1,
    );
    assert.equal(
      inbox.conversations.find((c) => c.botId === 'default' && c.title === 'Research')?.unread,
      1,
    );
    assert.equal(inbox.conversations.find((c) => c.botId === other.id)?.unread, 1);
    store.acknowledge('default', 'Bot Chat', 'compressed:8');
    store.acknowledge('default', 'Bot Chat', 'main:2');
    assert.equal(
      new Store(root)
        .inbox()
        .conversations.find((c) => c.botId === 'default' && c.title === 'Bot Chat')?.unread,
      0,
    );
    assert.deepEqual(
      store.history('default').sessions.map((s) => s.id),
      ['main', 'thread', 'compressed'],
    );
    for (const title of ['constructor', '__proto__']) {
      db.prepare("INSERT INTO sessions (id,title,source,started_at) VALUES (?,?,'cli',10)").run(
        title,
        title,
      );
      reply.run(title, 'assistant', 'A reply in an unusually named thread', 10);
      const message = store.history('default', title).messages.at(-1);
      assert.ok(message);
      store.acknowledge('default', title, message.id);
      assert.equal(new Store(root).inbox().conversations.find((c) => c.title === title)?.unread, 0);
    }
  } finally {
    db.close();
    second.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Recent transcript retains new delivery after 2000 messages and group reads never regress', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-recent-'));
  const store = new Store(root);
  const db = database(store, 'default');
  try {
    const insert = db.prepare(
      "INSERT INTO messages (session_id,role,content,timestamp) VALUES ('main','assistant',?,?)",
    );
    db.exec('BEGIN');
    for (let i = 1; i <= 2002; i++) insert.run(`Reply ${i}`, i);
    db.exec('COMMIT');
    const messages = store.history('default').messages;
    assert.equal(messages.length, 2000);
    assert.equal(messages[0]?.content, 'Reply 3');
    assert.equal(messages.at(-1)?.content, 'Reply 2002');
    store.state.groups.push({ id: 'team', name: 'Team', members: ['default', 'other'] });
    store.state.groupMessages.team = [
      { id: 'you', name: 'You', text: 'Hello', at: 1 },
      { id: 'a', name: 'Hermes', text: 'First', at: 2 },
      { id: 'b', name: 'Other', text: 'Second', at: 3 },
    ];
    assert.equal(store.inbox().groups[0]?.unread, 2);
    store.acknowledgeGroup('team', 'a');
    assert.equal(new Store(root).inbox().groups[0]?.unread, 1);
    store.acknowledgeGroup('team', 'you');
    assert.equal(store.inbox().groups[0]?.unread, 1);
    assert.throws(() => store.acknowledgeGroup('team', 'unknown'));
    store.acknowledgeGroup('team', 'b');
    assert.equal(new Store(root).inbox().groups[0]?.unread, 0);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
