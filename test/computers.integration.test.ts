import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/index';
import { z } from 'zod';

test(
  'Apple VMs persist isolated desktops and real Hermes discovers and calls computer MCP tools',
  { skip: process.env.TEAMMATES_TEST_COMPUTERS !== '1', timeout: 300000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-computers-'));
    let context = createApp(root);
    let server = context.app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    context.attach(server);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const names: string[] = [];
    const tools = new Set<string>();
    let called = false;
    let stage = 0;
    const received: string[] = [];
    const fixture = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      if (!raw || !req.url?.includes('chat/completions')) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      received.push(raw);
      const body = JSON.parse(raw);
      const available: string[] = (body.tools || []).map(
        (t: { function: { name: string } }) => t.function.name,
      );
      available.forEach((t) => tools.add(t));
      for (const name of raw.match(/mcp__teammates_computer__computer_\w+/g) || []) tools.add(name);
      const shell = [...tools].find((t) => t.endsWith('computer_shell'));
      let tool: { name: string; arguments: string } | undefined;
      if (stage === 0 && available.includes('tool_search')) {
        stage++;
        tool = {
          name: 'tool_search',
          arguments: JSON.stringify({ queries: ['computer'], limit: 10 }),
        };
      } else if (stage === 1 && shell) {
        stage++;
        tool = {
          name: 'tool_describe',
          arguments: JSON.stringify({
            names: [...tools].filter((t) => t.startsWith('mcp__teammates_computer__')),
          }),
        };
      } else if (shell && stage < 8) {
        const steps: { suffix: string; arguments: unknown }[] = [
          {
            suffix: 'computer_shell',
            arguments: {
              command:
                "printf '<title>Native MCP proof</title><h1>Bot computer</h1>' > native.html; printf native-mcp-proof > native.txt; cat native.txt",
            },
          },
          { suffix: 'computer_action', arguments: { type: 'key', key: 'ctrl+l' } },
          {
            suffix: 'computer_action',
            arguments: { type: 'type', text: 'file:///home/bot/workspace/native.html' },
          },
          { suffix: 'computer_action', arguments: { type: 'key', key: 'Return' } },
          { suffix: 'computer_screenshot', arguments: {} },
          {
            suffix: 'computer_shell',
            arguments: {
              command:
                'for i in 1 2 3 4 5 6 7 8 9 10; do title=$(xdotool getactivewindow getwindowname); case "$title" in *\'Native MCP proof\'*) printf \'%s\' "$title" > actions.txt; break;; esac; sleep 0.2; done',
            },
          },
        ];
        const step = steps[stage - 2];
        const name = [...tools].find((t) => t.endsWith(step.suffix));
        assert.ok(name);
        called = true;
        stage++;
        tool = {
          name: available.includes(name) ? name : 'tool_call',
          arguments: JSON.stringify(
            available.includes(name)
              ? step.arguments
              : { calls: [{ name, arguments: step.arguments }] },
          ),
        };
      }

      const message = tool
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: `computer-proof-${stage}`, type: 'function', function: tool }],
          }
        : { role: 'assistant', content: 'Computer proof complete.' };
      res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
      if (body.stream)
        res.end(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: tool ? { ...message, tool_calls: message.tool_calls?.map((c, index) => ({ index, ...c })) } : message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      else
        res.end(
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion',
            model: 'fixture-model',
            choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        );
    });
    fixture.listen(0, '127.0.0.1');
    await new Promise<void>((r) => fixture.once('listening', r));
    const endpoint = fixture.address();
    assert.ok(endpoint && typeof endpoint !== 'string');
    try {
      await context.hermes.probe();
      assert.ok(context.hermes.python);
      for (const id of [
        'default',
        context.store.createBot({
          name: 'Second computer',
          role: 'Keep separate files',
          color: 'green',
          provider: {
            kind: 'compatible',
            model: 'fixture-model',
            baseUrl: `http://127.0.0.1:${endpoint.port}/v1`,
          },
        }).id,
      ]) {
        const bot = context.store.bot(id);
        bot.computerEnabled = true;
        names.push(context.computers.name(id));
        context.computers.configure(bot, context.hermes.python);
      }
      const bot = context.store.updateBot('default', {
        name: 'Hermes',
        role: 'Use the computer tools for this proof.',
        color: 'orange',
        provider: {
          kind: 'compatible',
          model: 'fixture-model',
          baseUrl: `http://127.0.0.1:${endpoint.port}/v1`,
        },
      });
      context.store.setSecret(bot.id, 'OPENAI_API_KEY', 'test-provider-secret-not-in-vm');
      const first = await context.computers.wake(bot.id);
      assert.equal(first.state, 'running');
      const result = z.object({ output: z.string() }).parse(
        await context.computers.tool(bot.id, 'shell', {
          command: 'printf persistent-proof > proof.txt; id; env | cut -d= -f1',
        }),
      );
      assert.match(result.output, /uid=1000\(bot\)/);
      assert.doesNotMatch(result.output, /OPENAI_API_KEY|ANTHROPIC_API_KEY|HERMES_HOME/);
      const screen = z
        .object({ image: z.string() })
        .parse(await context.computers.tool(bot.id, 'screenshot', {}));
      assert.equal(Buffer.from(screen.image, 'base64').subarray(1, 4).toString(), 'PNG');
      fs.mkdirSync('test-artifacts', { recursive: true });
      fs.writeFileSync('test-artifacts/computer-vm.png', Buffer.from(screen.image, 'base64'));
      await context.computers.control(bot.id, true);
      await assert.rejects(
        context.computers.tool(bot.id, 'shell', { command: 'touch forbidden.txt' }),
        /human_has_control/,
      );
      await context.computers.control(bot.id, false);
      await context.computers.sleep(bot.id);
      await context.computers.wake(bot.id);
      assert.equal(
        z.object({ output: z.string() }).parse(
          await context.computers.tool(bot.id, 'shell', {
            command: 'cat proof.txt; test ! -e forbidden.txt',
          }),
        ).output,
        'persistent-proof',
      );
      const second = context.store.state.bots.find((b) => b.id !== 'default');
      assert.ok(second);
      await context.computers.wake(second.id);
      assert.equal(
        z.object({ output: z.string() }).parse(
          await context.computers.tool(second.id, 'shell', {
            command: 'test ! -e proof.txt; printf separate',
          }),
        ).output,
        'separate',
      );
      const denied = await fetch(`${base}/api/bots/${bot.id}/computer-tools/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid' },
        body: JSON.stringify({ command: 'touch wrong-token.txt' }),
      });
      assert.equal(denied.status, 403);
      await context.hermes.run(
        bot,
        'Use your computer shell to write native-mcp-proof to native.txt.',
        'Computer proof',
      );
      assert.ok(
        called,
        `Native MCP tools missing: ${[...tools].join(', ')}; responses: ${JSON.stringify(JSON.parse(received.at(-1) || '{}').messages?.slice(-3))}`,
      );
      assert.equal(
        z
          .object({ output: z.string() })
          .parse(await context.computers.tool(bot.id, 'shell', { command: 'cat native.txt' }))
          .output,
        'native-mcp-proof',
      );
      assert.ok([...tools].some((t) => t.endsWith('computer_screenshot')));
      assert.ok([...tools].some((t) => t.endsWith('computer_action')));
      assert.ok(received.some((r) => r.includes('native-mcp-proof')));
      assert.equal(stage, 8);
      const messages = received.flatMap((raw) => JSON.parse(raw).messages || []);
      const media = JSON.stringify(messages).match(/MEDIA:(\/[^\s"'<>]*?\.png)/)?.[1];
      assert.ok(media, 'Native MCP screenshot reaches Hermes as a cached image');
      assert.equal(fs.readFileSync(media).subarray(1, 4).toString(), 'PNG');
      assert.equal(
        z
          .object({ output: z.string() })
          .parse(await context.computers.tool(bot.id, 'shell', { command: 'cat actions.txt' }))
          .output,
        'Native MCP proof - Chromium',
      );
      await context.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      context = createApp(root);
      server = context.app.listen(0, '127.0.0.1');
      await new Promise<void>((r) => server.once('listening', r));
      context.attach(server);
      assert.equal((await context.computers.status(bot.id)).state, 'sleeping');
      await context.computers.wake(bot.id);
      assert.equal(
        z
          .object({ output: z.string() })
          .parse(await context.computers.tool(bot.id, 'shell', { command: 'cat native.txt' }))
          .output,
        'native-mcp-proof',
      );
      console.log(
        'Verified real VM isolation, screenshot, persistence, human control fence and native Hermes MCP actions, image cache and backend restart.',
      );
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => fixture.close(() => r()));
      for (const name of names) {
        await context.computers.command(['delete', name]).catch(() => {});
        await context.computers.command(['volume', 'delete', name]).catch(() => {});
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
