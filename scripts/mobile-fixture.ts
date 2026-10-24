/** Owned local acceptance host. Real Hermes runtime with deterministic model inference. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { createApp } from '../server/index';
import { createMobileGateway } from '../server/mobile';

const root = path.resolve(process.env.TEAMMATES_MOBILE_FIXTURE_DIR || 'test-artifacts/mobile-host');
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const markerFile = path.join(root, '.mobile-fixture');
if (!fs.existsSync(markerFile) && fs.existsSync(path.join(root, 'data')))
  throw new Error(
    'Refusing an existing unmarked data directory. Choose a fresh fixture directory.',
  );
fs.writeFileSync(markerFile, 'Hermes Teammates disposable acceptance fixture\n', { mode: 0o600 });
const key = path.join(root, 'key.pem');
const cert = path.join(root, 'cert.pem');
if (!fs.existsSync(cert))
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2',
    ],
    { stdio: 'ignore' },
  );
fs.chmodSync(key, 0o600);
const issued = new Set<string>();
const model = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  if (!req.url?.includes('chat/completions') || !raw) {
    res.writeHead(404).end('{}');
    return;
  }
  const body = JSON.parse(raw);
  const history = JSON.stringify(body.messages);
  const names: string[] = (body.tools || []).map(
    (t: { function: { name: string } }) => t.function.name,
  );
  const marker = [...history.matchAll(/MOBILE_(QUESTION|STOP|APPROVAL)_[A-Z0-9]+/g)].at(-1)?.[0];
  let tool: { name: string; arguments: string } | undefined;
  if (
    marker &&
    !issued.has(marker) &&
    (!marker.includes('PROACTIVE') || history.includes('[Cronjob '))
  ) {
    const name = marker.includes('APPROVAL') ? 'terminal' : 'clarify';
    if (names.includes(name)) {
      issued.add(marker);
      tool = {
        name,
        arguments: JSON.stringify(
          name === 'terminal'
            ? { command: 'rm -rf mobile-approval-target' }
            : { question: 'Which launch color should I use?', choices: ['Green', 'Blue'] },
        ),
      };
    }
  }
  const message = tool
    ? {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `mobile-${issued.size}`, type: 'function', function: tool }],
      }
    : {
        role: 'assistant',
        content: 'I reviewed the mobile launch brief. The sources are ready for your review.',
      };
  res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
  if (body.stream)
    res.end(
      `data: ${JSON.stringify({ id: 'mobile-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: tool ? { ...message, tool_calls: message.tool_calls?.map((c, index) => ({ index, ...c })) } : message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'mobile-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
    );
  else
    res.end(
      JSON.stringify({
        id: 'mobile-fixture',
        object: 'chat.completion',
        model: 'mobile-fixture',
        choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
});
model.listen(0, '127.0.0.1');
await new Promise<void>((r) => model.once('listening', r));
const modelAddress = model.address();
if (!modelAddress || typeof modelAddress === 'string') throw new Error('Missing model');
process.env.TEAMMATES_MOBILE_URL = 'https://localhost:14311';
const context = createApp(path.join(root, 'data'));
if (
  context.store.state.bots.length === 1 &&
  context.store.bot('default').provider.kind === 'claude'
)
  context.store.updateBot('default', {
    name: 'Hermes',
    role: 'Your thoughtful generalist. Research, planning and the work between.',
    color: 'white',
    provider: {
      kind: 'compatible',
      model: 'mobile-fixture',
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
    },
  });
for (const bot of context.store.state.bots)
  context.store.updateBot(bot.id, {
    ...bot,
    provider: {
      kind: 'compatible',
      model: 'mobile-fixture',
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
    },
  });
context.app.use(express.static(path.resolve('dist/web')));
const local = context.app.listen(14310, '127.0.0.1');
await new Promise<void>((r) => local.once('listening', r));
context.attach(local);
await context.hermes.probe();
context.hermes.startScheduler();
const gateway = https.createServer(
  { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
  createMobileGateway(context.mobile, 'http://127.0.0.1:14310', 'https://localhost:14311'),
);
gateway.listen(14311, '0.0.0.0');
await new Promise<void>((r) => gateway.once('listening', r));
// Browser acceptance transport is explicitly fixture-only. Production gateway has no CORS.
const browser = express();
browser.use(express.static(path.resolve('dist/mobile')));
const web = browser.listen(14312, '127.0.0.1');
const pairing = context.mobile.createPairing();
fs.writeFileSync(
  path.join(root, 'pairing.json'),
  JSON.stringify({ url: 'https://localhost:14311', ...pairing }),
  { mode: 0o600 },
);
process.stdout.write(
  'Mobile fixture ready. Pairing material is in ignored test-artifacts/mobile-host/pairing.json. No live provider calls.\n',
);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void context.close().finally(() => {
      for (const server of [local, gateway, model, web]) server.close();
    });
  });
