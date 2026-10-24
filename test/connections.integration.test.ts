import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { createApp } from '../server/index';
import { nativeServerName } from '../server/connections';
import { appModelFixture } from './fixtures/app-model';

const installed = fs.existsSync(
  process.env.HERMES_EXECUTABLE || path.join(os.homedir(), '.local/bin/hermes'),
);
test(
  'Native Hermes MCP reviews execute edited arguments, deny and Stop, with per-Bot credentials',
  { skip: !installed, timeout: 150000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-connections-'));
    const context = createApp(root);
    const backend = http.createServer(context.app);
    const fixture = appModelFixture();
    const httpCalls: { args: unknown; authorized: boolean }[] = [];
    const appServer = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      if (req.method !== 'POST' || !raw) {
        res.writeHead(405).end();
        return;
      }
      const request = JSON.parse(raw);
      if (!('id' in request)) {
        res.writeHead(202).end();
        return;
      }
      let result;
      if (request.method === 'initialize')
        result = {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'http-proof', version: '1' },
        };
      else if (request.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'send_message',
              description: 'Send a message',
              inputSchema: {
                type: 'object',
                properties: { recipient: { type: 'string' }, text: { type: 'string' } },
                required: ['recipient', 'text'],
              },
            },
          ],
        };
      else {
        httpCalls.push({
          args: request.params.arguments,
          authorized: req.headers.authorization === 'Bearer synthetic-http-credential',
        });
        result = { content: [{ type: 'text', text: 'HTTP message delivered' }] };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
    appServer.listen(0, '127.0.0.1');
    await new Promise<void>((r) => appServer.once('listening', r));
    backend.listen(0, '127.0.0.1');
    fixture.server.listen(0, '127.0.0.1');
    await Promise.all([
      new Promise<void>((r) => backend.once('listening', r)),
      new Promise<void>((r) => fixture.server.once('listening', r)),
    ]);
    context.attach(backend);
    const address = fixture.server.address();
    assert.ok(address && typeof address !== 'string');
    const output = path.join(root, 'executions.jsonl');
    try {
      await context.hermes.probe();
      assert.ok(context.hermes.runtime.available);
      const bot = context.store.updateBot('default', {
        name: 'App proof',
        role: 'Use the connected send_message tool.',
        color: 'orange',
        provider: {
          kind: 'compatible',
          model: 'fixture-model',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
        },
      });
      context.store.setSecret(bot.id, 'OPENAI_API_KEY', 'synthetic-model-provider');
      context.store.setSecret(bot.id, 'SERVICE_KEY', 'synthetic-app-credential');
      const configPath = path.join(context.store.home(bot.id), 'config.yaml');
      const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
      config.mcp_servers = { unrelated: { command: '/unused', enabled: false } };
      config.hooks = { pre_tool_call: [{ command: '/unused', matcher: 'never-match' }] };
      context.store.atomic(configPath, YAML.stringify(config));
      const allowlistPath = path.join(context.store.home(bot.id), 'shell-hooks-allowlist.json');
      context.store.atomic(
        allowlistPath,
        JSON.stringify({ approvals: [{ event: 'pre_tool_call', command: '/unused' }] }),
      );
      const connection = context.connections.save(bot.id, {
        name: 'Proof messenger',
        enabled: true,
        review: true,
        server: {
          transport: 'stdio',
          command: process.execPath,
          args: [path.resolve('test/fixtures/app-mcp.mjs'), output],
          env: { APP_TOKEN: 'SERVICE_KEY' },
        },
      });
      const other = context.store.createBot({
        name: 'Other',
        role: 'Separate',
        color: 'green',
        provider: bot.provider,
      });
      assert.deepEqual(context.connections.list(other.id), []);
      assert.doesNotMatch(
        fs.readFileSync(path.join(context.store.home(bot.id), 'config.yaml'), 'utf8'),
        /synthetic-app-credential/,
      );
      async function review() {
        const until = Date.now() + 35000;
        while (Date.now() < until) {
          const req = context.connections.views()[0];
          if (req) return req;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(
          `No review. Activity: ${JSON.stringify(context.store.state.activity.slice(-6))}. Model: ${JSON.stringify(JSON.parse(fixture.received.filter((r) => r.includes('tool_call_id')).at(-1) || '{}').messages?.filter((m: { role: string }) => m.role === 'tool'))}`,
        );
      }
      const run = context.hermes.run(bot, 'APP_REVIEW_ALLOW: send the draft.', 'Review allow');
      void run.catch(() => {});
      const request = await review();
      assert.equal(fs.existsSync(output), false, 'Draft must wait before executing');
      assert.throws(
        () =>
          context.connections.respond(other.id, request.id, {
            kind: 'action',
            result: { decision: 'deny' },
          }),
        /no longer/,
      );
      assert.throws(
        () =>
          context.connections.respond(bot.id, request.id, {
            kind: 'action',
            result: { decision: 'approve', args: { text: 'Missing recipient' } },
          }),
        /original field/,
      );
      context.connections.respond(bot.id, request.id, {
        kind: 'action',
        result: {
          decision: 'approve',
          args: { recipient: 'reviewed@example.test', text: 'Reviewed draft' },
        },
      });
      await run;
      const records = fs
        .readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.equal(records.length, 1);
      assert.deepEqual(records[0].args, {
        recipient: 'reviewed@example.test',
        text: 'Reviewed draft',
      });
      assert.equal(
        records[0].credentialHash,
        createHash('sha256').update('synthetic-app-credential').digest('hex'),
      );
      assert.equal(records[0].providerPresent, false);
      assert.ok(fixture.received.some((r) => r.includes('Reviewed draft')));
      for (const mode of ['DENY', 'STOP']) {
        const pending = context.hermes.run(
          bot,
          `APP_REVIEW_${mode}: send the draft.`,
          `Review ${mode}`,
        );
        void pending.catch(() => {});
        const req = await review();
        if (mode === 'DENY')
          context.connections.respond(bot.id, req.id, {
            kind: 'action',
            result: { decision: 'deny' },
          });
        else {
          context.connections.cancelBot(bot.id);
          await context.hermes.stop(bot.id);
        }
        await pending.catch(() => {});
        assert.equal(context.connections.views().length, 0);
        assert.throws(
          () =>
            context.connections.respond(bot.id, req.id, {
              kind: 'action',
              result: { decision: 'approve', args: req.args },
            }),
          /no longer/,
        );
        assert.equal(fs.readFileSync(output, 'utf8').trim().split('\n').length, 1);
      }
      // Honor an explicit operator timeout; an expired review cannot execute later.
      const expiring = YAML.parse(fs.readFileSync(configPath, 'utf8'));
      expiring.plugins.hook_callback_timeout = 6;
      context.store.atomic(configPath, YAML.stringify(expiring));
      context.hermes.reset(bot.id);
      const expiryRun = context.hermes.run(
        bot,
        'APP_REVIEW_EXPIRE: send the draft.',
        'Review expiry',
      );
      void expiryRun.catch(() => {});
      const expired = await review();
      await expiryRun;
      assert.equal(context.connections.views().length, 0);
      assert.throws(
        () =>
          context.connections.respond(bot.id, expired.id, {
            kind: 'action',
            result: { decision: 'approve', args: expired.args },
          }),
        /no longer/,
      );
      assert.equal(fs.readFileSync(output, 'utf8').trim().split('\n').length, 1);
      assert.equal(
        YAML.parse(fs.readFileSync(configPath, 'utf8')).plugins.hook_callback_timeout,
        6,
      );
      const httpAddress = appServer.address();
      assert.ok(httpAddress && typeof httpAddress !== 'string');
      context.store.setSecret(other.id, 'SERVICE_KEY', 'synthetic-http-credential');
      context.store.setSecret(other.id, 'OPENAI_API_KEY', 'synthetic-other-provider');
      context.connections.save(other.id, {
        name: 'HTTP messenger',
        enabled: true,
        review: true,
        server: {
          transport: 'http',
          url: `http://127.0.0.1:${httpAddress.port}/mcp`,
          bearerCredential: 'SERVICE_KEY',
        },
      });
      const httpRun = context.hermes.run(other, 'APP_REVIEW_HTTP: send the draft.', 'HTTP review');
      void httpRun.catch(() => {});
      const httpReview = await review();
      assert.equal(httpReview.botId, other.id);
      context.connections.respond(other.id, httpReview.id, {
        kind: 'action',
        result: {
          decision: 'approve',
          args: { recipient: 'http@example.test', text: 'Reviewed HTTP message' },
        },
      });
      await httpRun;
      assert.deepEqual(httpCalls, [
        {
          args: { recipient: 'http@example.test', text: 'Reviewed HTTP message' },
          authorized: true,
        },
      ]);
      const backendAddress = backend.address();
      assert.ok(backendAddress && typeof backendAddress !== 'string');
      const unauthorized = await fetch(
        `http://127.0.0.1:${backendAddress.port}/api/bots/default/action-review`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      assert.equal(unauthorized.status, 403);
      context.connections.remove(bot.id, connection.id);
      const remaining = YAML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.deepEqual(remaining.mcp_servers, {
        unrelated: { command: '/unused', enabled: false },
      });
      assert.deepEqual(remaining.hooks.pre_tool_call, [
        { command: '/unused', matcher: 'never-match' },
      ]);
      assert.deepEqual(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')).approvals, [
        { event: 'pre_tool_call', command: '/unused' },
      ]);
      assert.equal(
        fs.existsSync(path.join(context.store.home(bot.id), '.teammates-app-review.json')),
        false,
      );
      assert.deepEqual(context.connections.list(bot.id), []);
      const idleConnection = context.connections.list(other.id)[0];
      const idle = await context.connections.request(other.id, {
        hook_event_name: 'pre_tool_call',
        tool_name: `mcp__${nativeServerName(idleConnection.id)}__send_message`,
        tool_input: { recipient: 'idle@example.test', text: 'Must not run' },
        session_id: 'not-an-active-native-session',
        extra: { tool_call_id: 'idle-proof' },
      });
      assert.equal((await idle.result).action, 'block');
      const savedConfig = fs.readFileSync(configPath, 'utf8');
      const savedMetadata = fs.readFileSync(context.store.statePath, 'utf8');
      const invalidConsent = JSON.stringify({ approvals: 'malformed' });
      context.store.atomic(allowlistPath, invalidConsent);
      assert.throws(() => context.connections.save(bot.id, connection));
      assert.deepEqual(context.connections.list(bot.id), []);
      assert.equal(fs.readFileSync(configPath, 'utf8'), savedConfig);
      assert.equal(fs.readFileSync(context.store.statePath, 'utf8'), savedMetadata);
      assert.equal(fs.readFileSync(allowlistPath, 'utf8'), invalidConsent);
      assert.equal(
        fs.existsSync(path.join(context.store.home(bot.id), '.teammates-app-review.json')),
        false,
      );
    } finally {
      await context.close();
      await Promise.all([
        new Promise<void>((r) => backend.close(() => r())),
        new Promise<void>((r) => fixture.server.close(() => r())),
        new Promise<void>((r) => appServer.close(() => r())),
      ]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
