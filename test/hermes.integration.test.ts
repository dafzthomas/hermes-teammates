import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Store } from '../server/store';
import { Hermes } from '../server/hermes';

const installed = fs.existsSync(
  process.env.HERMES_EXECUTABLE || path.join(os.homedir(), '.local/bin/hermes'),
);

test(
  'Real Hermes persists resources, exchanges messages, runs routines and supports both model protocols',
  { skip: !installed, timeout: 180000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-hermes-'));
    const store = new Store(root);
    const hermes = new Hermes(store, () => {});
    const teammate = store.createBot({
      name: 'Researcher',
      role: 'Research assigned questions and report findings.',
      color: 'green',
      provider: { kind: 'compatible', model: 'fixture-model', baseUrl: 'http://127.0.0.1:1/v1' },
    });
    let requests = 0;
    let anthropicRequests = 0;
    const toolNames = new Set<string>();
    const fixture = http.createServer(async (req, res) => {
      if (req.url?.endsWith('/models')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({ data: [{ id: 'fixture-model', object: 'model', owned_by: 'test' }] }),
        );
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      if (raw && req.url?.endsWith('/messages')) {
        anthropicRequests++;
        const body = JSON.parse(raw);
        const message = {
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Claude transport integration complete.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 10 },
        };
        res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
        if (body.stream) {
          const events = [
            {
              type: 'message_start',
              message: {
                ...message,
                content: [],
                stop_reason: null,
                usage: { input_tokens: 20, output_tokens: 0 },
              },
            },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: message.content[0].text },
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 10 },
            },
            { type: 'message_stop' },
          ];
          res.end(
            events
              .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
              .join(''),
          );
        } else res.end(JSON.stringify(message));
        return;
      }
      if (!raw || !req.url?.includes('chat/completions')) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      const body = JSON.parse(raw);
      const tools = (body.tools || []).map((t: { function: { name: string } }) => t.function.name);
      for (const name of tools) toolNames.add(name);
      let calls:
        { id: string; type: string; function: { name: string; arguments: string } }[] | undefined;
      const first = requests++ === 0;
      if (first && tools.includes('memory') && tools.includes('write_file'))
        calls = [
          {
            id: 'call_memory',
            type: 'function',
            function: {
              name: 'memory',
              arguments: JSON.stringify({
                action: 'add',
                target: 'memory',
                content: 'Integration fact: the launch color is green.',
              }),
            },
          },
          {
            id: 'call_file',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                path: path.join(store.home('default'), 'workspace', 'proof.txt'),
                content: 'Written by the real Hermes file tool.',
              }),
            },
          },
        ];
      if (first && tools.includes('message_agent'))
        calls?.push({
          id: 'call_teammate',
          type: 'function',
          function: {
            name: 'message_agent',
            arguments: JSON.stringify({
              target: teammate.id,
              message: 'Please independently check that the launch color is green.',
            }),
          },
        });
      const content = calls ? '' : 'Hermes integration complete. The launch color is green.';
      res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
      if (body.stream) {
        const delta = calls
          ? { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, ...call })) }
          : { role: 'assistant', content };
        res.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\ndata: [DONE]\n\n`,
        );
        res.end();
      } else
        res.end(
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
                finish_reason: calls ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          }),
        );
    });
    fixture.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => fixture.once('listening', resolve));
    const address = fixture.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const bot = store.updateBot('default', {
        ...store.bot('default'),
        provider: {
          kind: 'compatible',
          model: 'fixture-model',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
        },
      });
      store.setSecret(bot.id, 'OPENAI_API_KEY', 'fixture-only-not-a-real-key');
      store.updateBot(teammate.id, { ...teammate, provider: bot.provider });
      store.setSecret(teammate.id, 'OPENAI_API_KEY', 'fixture-teammate-only');
      await hermes.probe();
      assert.equal(hermes.runtime.available, true, hermes.runtime.error || '');
      const answer = await hermes.run(bot, 'Remember the launch color and write the proof file.');
      assert.match(answer, /Hermes integration complete/);
      assert.ok(toolNames.has('memory'));
      assert.ok(toolNames.has('write_file'));
      assert.ok(toolNames.has('message_agent'), 'Native Bot Chat should expose teammate messaging');
      assert.match(store.memory(bot.id, 'MEMORY'), /launch color is green/);
      assert.equal(
        fs.readFileSync(path.join(store.home(bot.id), 'workspace', 'proof.txt'), 'utf8'),
        'Written by the real Hermes file tool.',
      );
      await hermes.run(bot, 'What color did we agree on?');
      const history = store.history(bot.id);
      const firstUser = history.messages.find(
        (m) => m.content === 'Remember the launch color and write the proof file.',
      );
      const resumedUser = history.messages.find((m) => m.content === 'What color did we agree on?');
      assert.ok(firstUser);
      assert.ok(resumedUser);
      assert.equal(firstUser.sessionId, resumedUser.sessionId);
      assert.match(history.messages.at(-1)?.content || '', /green/);
      const deadline = Date.now() + 20000;
      while (
        !store.history(teammate.id).messages.some((m) => m.role === 'assistant') &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(
        store
          .history(teammate.id)
          .messages.some((m) => m.role === 'user' && m.content.includes('launch color')),
        `Native message should reach the recipient transcript: ${JSON.stringify(history.messages.filter((m) => m.role === 'user'))}`,
      );
      assert.ok(
        store.history(teammate.id).messages.some((m) => m.role === 'assistant'),
        'Recipient should respond using its own provider profile',
      );
      assert.equal(
        store.memory(teammate.id, 'MEMORY'),
        '',
        'Recipient must not inherit sender memory',
      );
      if (hermes.python) {
        await hermes.routines(bot.id, 'create', {
          name: 'Integration reminder',
          prompt: 'Review saved priorities.',
          schedule: 'every 24h',
        });
        const jobs = await hermes.routines(bot.id, 'list');
        assert.ok(Array.isArray(jobs));
        assert.equal(jobs.length, 1);
        await hermes.routines(bot.id, 'pause', { id: jobs[0].id });
        const paused = await hermes.routines(bot.id, 'list');
        assert.ok(Array.isArray(paused));
        assert.equal(paused[0].state, 'paused');
        await hermes.routines(bot.id, 'resume', { id: jobs[0].id });
        await hermes.routines(bot.id, 'remove', { id: jobs[0].id });
        await hermes.routines(bot.id, 'create', {
          name: 'Scheduled execution proof',
          prompt: 'Produce the integration completion statement.',
          schedule: new Date(Date.now() + 2000).toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await hermes.cli(['cron', 'tick'], store.home(bot.id), 60000);
        assert.ok(
          store
            .outputs(bot.id)
            .some((output) => output.content.includes('Hermes integration complete')),
          'A native scheduled run must produce a visible result',
        );
      }
      const claude = store.updateBot(bot.id, {
        ...bot,
        provider: { kind: 'claude', model: 'claude-sonnet-4-6', borrowLogin: false },
      });
      store.setSecret(bot.id, 'ANTHROPIC_API_KEY', 'fixture-anthropic-only');
      store.setSecret(bot.id, 'ANTHROPIC_BASE_URL', `http://127.0.0.1:${address.port}/anthropic`);
      const claudeAnswer = await hermes.run(
        claude,
        'Reply with the Claude transport integration statement.',
        'Claude transport proof',
      );
      assert.match(claudeAnswer, /Claude transport integration complete/);
      assert.ok(anthropicRequests > 0, 'Claude access must use the native Anthropic protocol');
    } finally {
      await hermes.close();
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
