import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Store } from '../server/store';
import { Hermes } from '../server/hermes';
import type { InteractiveRequest } from '../src/domain';

const installed = fs.existsSync(
  process.env.HERMES_EXECUTABLE || path.join(os.homedir(), '.local/bin/hermes'),
);
async function waitForRequest(hermes: Hermes, kind: InteractiveRequest['kind']) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const request = [...hermes.requests.values()].find((r) => r.view.kind === kind)?.view;
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `No ${kind} request arrived. Activity: ${JSON.stringify(hermes.store.state.activity.slice(-5))}`,
  );
}

test(
  'Native questions, private skill setup, steering, approvals and Stop keep one persistent session',
  { skip: !installed, timeout: 150000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teammates-interactive-'));
    const store = new Store(root);
    const hermes = new Hermes(store, () => {});
    const target = path.join(store.home('default'), 'workspace', 'approval-proof');
    store.atomic(
      store.safeFile('default', 'skills', 'private-setup-proof'),
      '---\nname: private-setup-proof\ndescription: Test private credential setup\nrequired_environment_variables:\n  - TEAMMATES_FIXTURE_TOKEN\n---\nUse the configured token without printing its value.\n',
    );
    const issued = new Set<string>();
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
      const text = JSON.stringify(body.messages);
      const tools: string[] = (body.tools || []).map(
        (t: { function: { name: string } }) => t.function.name,
      );
      let call: { name: string; arguments: string } | undefined;
      if (tools.includes('clarify') && text.includes('QUESTION_PROOF') && !issued.has('question')) {
        issued.add('question');
        call = {
          name: 'clarify',
          arguments: JSON.stringify({
            question: 'Which launch color should I use?',
            choices: ['Green', 'Blue'],
          }),
        };
      } else if (
        tools.includes('clarify') &&
        text.includes('BATCH_PROOF') &&
        !issued.has('batch')
      ) {
        issued.add('batch');
        call = {
          name: 'clarify',
          arguments: JSON.stringify({
            questions: [
              {
                question: 'Which sources should I check?',
                choices: ['Official docs', 'Release notes', 'Community posts'],
                multi_select: true,
              },
              { question: 'What should the brief be called?' },
            ],
          }),
        };
      } else if (
        tools.includes('skill_view') &&
        text.includes('SECRET_PROOF') &&
        !issued.has('secret')
      ) {
        issued.add('secret');
        call = { name: 'skill_view', arguments: JSON.stringify({ name: 'private-setup-proof' }) };
      } else if (tools.includes('terminal') && text.includes('DENY_PROOF') && !issued.has('deny')) {
        issued.add('deny');
        call = { name: 'terminal', arguments: JSON.stringify({ command: `rm -rf '${target}'` }) };
      } else if (
        tools.includes('terminal') &&
        text.includes('ALLOW_PROOF') &&
        !issued.has('allow')
      ) {
        issued.add('allow');
        call = { name: 'terminal', arguments: JSON.stringify({ command: `rm -rf '${target}'` }) };
      } else if (tools.includes('clarify') && text.includes('STOP_PROOF') && !issued.has('stop')) {
        issued.add('stop');
        call = {
          name: 'clarify',
          arguments: JSON.stringify({ question: 'Should this waiting turn continue?' }),
        };
      }
      const message = call
        ? {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: `call_${issued.size}`, type: 'function', function: call }],
          }
        : { role: 'assistant', content: 'Interactive runtime proof complete.' };
      res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
      if (body.stream) {
        const delta = call
          ? { role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls?.[0] }] }
          : message;
        res.end(
          `data: ${JSON.stringify({ id: 'interactive', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'interactive', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      } else
        res.end(
          JSON.stringify({
            id: 'interactive',
            object: 'chat.completion',
            model: 'fixture-model',
            choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }],
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
      store.setSecret(bot.id, 'OPENAI_API_KEY', 'fixture-only-private');
      await hermes.probe();
      const questionRun = hermes.run(bot, 'QUESTION_PROOF: ask which color to use.');
      // Attach a rejection handler immediately while the test drives the pending request.
      void questionRun.catch(() => {});
      const question = await waitForRequest(hermes, 'clarify');
      assert.equal(question.kind, 'clarify');
      const gateway = hermes.gateways.get(bot.id);
      assert.ok(gateway);
      const pid = gateway.child.pid;
      assert.throws(
        () =>
          hermes.respond('different-bot', question.id, {
            kind: 'clarify',
            answers: { answer: 'Green' },
          }),
        /no longer waiting/,
      );
      assert.throws(
        () => hermes.respond(bot.id, question.id, { kind: 'approval', choice: 'once' }),
        /does not match/,
      );
      await hermes.steer(bot.id, 'Bot Chat', 'STEERING_PROOF: include the source links.');
      hermes.respond(bot.id, question.id, { kind: 'clarify', answers: { answer: 'Green' } });
      assert.match(await questionRun, /proof complete/);
      assert.ok(
        received.some(
          (r) => r.includes('Green') && r.includes('STEERING_PROOF') && r.includes('tool_call_id'),
        ),
        'The next model request must receive the answer and queued steering',
      );
      assert.equal(hermes.requests.size, 0);
      const batchRun = hermes.run(bot, 'BATCH_PROOF: ask both independent questions.');
      void batchRun.catch(() => {});
      const batch = await waitForRequest(hermes, 'clarify');
      assert.equal(batch.kind, 'clarify');
      if (batch.kind !== 'clarify') throw new Error('Expected a question batch');
      assert.equal(batch.questions.length, 2);
      assert.equal(batch.questions[0].multi_select, true);
      hermes.respond(bot.id, batch.id, {
        kind: 'clarify',
        answers: {
          [batch.questions[0].qid]: JSON.stringify(['Official docs', 'Release notes']),
          [batch.questions[1].qid]: 'Launch source brief',
        },
      });
      await batchRun;
      assert.ok(
        received.some(
          (r) =>
            r.includes('Launch source brief') &&
            r.includes('Official docs') &&
            r.includes('Release notes'),
        ),
      );
      const secretRun = hermes.run(bot, 'SECRET_PROOF: load the private setup proof skill.');
      void secretRun.catch(() => {});
      const secret = await waitForRequest(hermes, 'secret');
      assert.equal(secret.kind, 'secret');
      if (secret.kind !== 'secret') throw new Error('Expected private setup input');
      assert.equal(secret.envVar, 'TEAMMATES_FIXTURE_TOKEN');
      const privateValue = 'synthetic-private-setup-value';
      hermes.respond(bot.id, secret.id, { kind: 'secret', value: privateValue });
      await secretRun;
      assert.equal(store.secretEntries(bot.id).TEAMMATES_FIXTURE_TOKEN, privateValue);
      assert.equal(
        JSON.stringify(store.state).includes(privateValue),
        false,
        'App metadata must not record a private input',
      );
      assert.equal(
        JSON.stringify(store.history(bot.id)).includes(privateValue),
        false,
        'Private setup input must not enter the visible transcript',
      );
      assert.equal(
        received.some((r) => r.includes(privateValue)),
        false,
        'The model receives a setup result, never the credential',
      );
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'keep.txt'), 'Owned test data');
      const deniedRun = hermes.run(bot, 'DENY_PROOF: remove the temporary proof folder.');
      void deniedRun.catch(() => {});
      const denied = await waitForRequest(hermes, 'approval');
      assert.equal(fs.existsSync(target), true, 'Command must not run before approval');
      hermes.respond(bot.id, denied.id, { kind: 'approval', choice: 'deny' });
      await deniedRun;
      assert.equal(fs.existsSync(target), true, 'Denied command must leave its target intact');
      const allowedRun = hermes.run(bot, 'ALLOW_PROOF: remove the temporary proof folder.');
      void allowedRun.catch(() => {});
      const allowed = await waitForRequest(hermes, 'approval');
      hermes.respond(bot.id, allowed.id, { kind: 'approval', choice: 'once' });
      await allowedRun;
      assert.equal(fs.existsSync(target), false, 'An explicitly allowed command should execute');
      const stoppedRun = hermes.run(bot, 'STOP_PROOF: ask before continuing.');
      void stoppedRun.catch(() => {});
      await waitForRequest(hermes, 'clarify');
      await hermes.stop(bot.id);
      await assert.rejects(stoppedRun, /stopped|interrupt/i);
      assert.equal(hermes.requests.size, 0);
      assert.equal(hermes.running.size, 0);
      assert.match(await hermes.run(bot, 'Resume after Stop.'), /proof complete/);
      assert.equal(
        hermes.gateways.get(bot.id)?.child.pid,
        pid,
        'Every turn must reuse the same native gateway',
      );
      const history = store.history(bot.id);
      assert.equal(
        new Set(history.messages.filter((m) => m.role === 'user').map((m) => m.sessionId)).size,
        1,
      );
      assert.equal(JSON.stringify(store.state.activity).includes('fixture-only-private'), false);
    } finally {
      await hermes.close();
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
