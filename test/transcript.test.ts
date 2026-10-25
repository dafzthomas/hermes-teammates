import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../src/domain';
import { activityLabel, groupTranscript, presentMessage } from '../src/transcriptPresentation';

function message(id: string, changes: Partial<Message> = {}): Message {
  return {
    id,
    role: 'tool',
    content: 'Recorded output',
    timestamp: 1,
    sessionId: 'session-1',
    toolName: 'terminal',
    ...changes,
  };
}

test('adjacent recorded tools share a group without inferring commands or changed files', () => {
  const input = [
    message('1', { content: 'Ran 19 commands and changed 2 files' }),
    message('2', { toolName: 'read_file' }),
    message('3', { toolName: null }),
  ];
  const blocks = groupTranscript(input);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'activity');
  if (blocks[0].kind !== 'activity') assert.fail();
  assert.deepEqual(
    blocks[0].actions.map((a) => a.message),
    input,
  );
  assert.deepEqual(
    blocks[0].actions.map((a) => a.label),
    ['Terminal', 'Read file', 'Tool call'],
  );
  assert.equal(activityLabel(blocks[0].actions.length), '3 tool calls recorded');
  assert.equal(activityLabel(1), '1 tool call recorded');
});

test('session boundaries split activity even for adjacent calls with identical timestamps', () => {
  const blocks = groupTranscript([message('1'), message('2', { sessionId: 'session-2' })]);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['activity', 'activity'],
  );
});

test('conversation, system and unknown roles stay visible and preserve supplied chronology', () => {
  const input = [
    message('1', { timestamp: 30 }),
    message('2', { role: 'assistant', timestamp: 20 }),
    message('3', { role: 'system', content: 'Context was updated' }),
    message('4', { role: 'custom', content: '' }),
    message('5', { role: 'user' }),
    message('6', { timestamp: 10 }),
  ];
  const blocks = groupTranscript(input);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['activity', 'message', 'message', 'message', 'message', 'activity'],
  );
  assert.deepEqual(
    blocks.flatMap((b) => (b.kind === 'activity' ? b.actions.map((a) => a.message) : [b.message])),
    input,
  );
});

test('canonical incoming teammate messages retain sender attribution and break activity', () => {
  const incoming = message('2', {
    role: 'user',
    content: 'Message from 🤖 Researcher (@researcher):\nFindings\nSecond line',
  });
  assert.deepEqual(presentMessage(incoming), {
    kind: 'incoming',
    message: incoming,
    sender: 'Researcher (@researcher)',
    body: 'Findings\nSecond line',
  });
  assert.deepEqual(
    groupTranscript([message('1'), incoming, message('3')]).map((b) => b.kind),
    ['activity', 'incoming', 'activity'],
  );
});

test('routine delivery remains separate with its exact name and body', () => {
  const routine = message('2', {
    role: 'user',
    content: '[Cronjob "Morning brief" output at 09:00]\nA question for you',
  });
  assert.deepEqual(presentMessage(routine), {
    kind: 'routine',
    message: routine,
    name: 'Morning brief',
    body: 'A question for you',
  });
  assert.deepEqual(
    groupTranscript([message('1'), routine, message('3')]).map((b) => b.kind),
    ['activity', 'routine', 'activity'],
  );
});

test('outgoing handoffs and returned outcomes stay separate without invented lifecycle states', () => {
  const dispatch = message('2', { toolName: 'message_agent', content: 'Native dispatch output' });
  const outcome = message('4', {
    role: 'user',
    content: '[IMPORTANT: Background process returned]\nRaw outcome',
  });
  const blocks = groupTranscript([message('1'), dispatch, message('3'), outcome]);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['activity', 'action', 'activity', 'action'],
  );
  assert.deepEqual(presentMessage(dispatch), {
    kind: 'action',
    message: dispatch,
    label: 'Bot handoff · dispatch status',
    icon: 'handoff',
  });
  assert.deepEqual(presentMessage(outcome), {
    kind: 'action',
    message: outcome,
    label: 'Bot handoff outcome',
    icon: 'handoff',
  });
});

test('recorded failures break activity and remain outside grouped disclosures', () => {
  for (const content of [
    '{"error":"Permission denied"}',
    '{"is_error":true,"content":"Unavailable"}',
    '{"success":false}',
    '{"exit_code":1,"stdout":""}',
    'Error: unavailable',
    'Progress\nCommand failed with code 1',
    'Permission denied',
    'Traceback (most recent call last):',
  ]) {
    const failure = message('2', { content });
    const blocks = groupTranscript([message('1'), failure, message('3')]);
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['activity', 'attention', 'activity'],
      content,
    );
    assert.equal(presentMessage(failure).message.content, content);
  }
});

test('failed handoffs remain outside grouped activity', () => {
  for (const record of [
    message('1', { toolName: 'message_agent', content: '{"error":"Unknown recipient"}' }),
    message('2', {
      role: 'user',
      content: '[IMPORTANT: Background process returned]\nError: timed out',
    }),
  ])
    assert.equal(presentMessage(record).kind, 'attention');
});

test('completed clarify output groups with tools and retains its raw output for nested disclosure', () => {
  const clarify = message('2', {
    toolName: 'clarify',
    content: '{"question":"Which option?","answer":"Green"}',
  });
  const blocks = groupTranscript([message('1'), clarify, message('3')]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'activity');
  if (blocks[0].kind !== 'activity') assert.fail();
  assert.deepEqual(
    blocks[0].actions.map((a) => a.label),
    ['Terminal', 'Clarify', 'Terminal'],
  );
  assert.equal(blocks[0].actions[1].message.content, clarify.content);
});

test('plain assistant prose with delivery-like text remains an ordinary message', () => {
  for (const content of [
    '[IMPORTANT: Background process example]',
    'Message from 🤖 Researcher (@researcher): example',
    '[Cronjob "Example" output]\nExample',
  ])
    assert.equal(presentMessage(message('1', { role: 'assistant', content })).kind, 'message');
});

test('grouping does not mutate records or retain groups between refreshes', () => {
  const record = Object.freeze(message('1', { content: '{"error":null,"exit_code":0}' }));
  const records = Object.freeze([record]);
  const first = groupTranscript(records);
  const second = groupTranscript([...records, message('2')]);
  assert.equal(first[0].kind === 'activity' && first[0].actions.length, 1);
  assert.equal(second[0].kind === 'activity' && second[0].actions.length, 2);
  assert.deepEqual(groupTranscript([]), []);
});
