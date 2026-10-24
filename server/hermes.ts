import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  routineSchema,
  questionSchema,
  type Bot,
  type InteractiveRequest,
  type RequestResponse,
} from '../src/domain';
import { Gateway, type GatewayFrame } from './gateway';
import { Store } from './store';

const eventSchema = z.object({
  type: z.string(),
  session_id: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});
const sessionResultSchema = z.object({ session_id: z.string() });
const nativeQuestionSchema = z.object({
  session_id: z.string(),
  question: z.string().nullable().optional(),
  choices: z.array(z.string()).nullable().optional(),
  multi_select: z.boolean().nullable().optional(),
  questions: z.array(questionSchema).nullable().optional(),
});
const nativeApprovalSchema = z.object({
  session_id: z.string(),
  command: z.string().default(''),
  description: z.string().default(''),
  choices: z.array(z.enum(['once', 'session', 'always', 'deny'])).default(['once', 'deny']),
});

export function childEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'COMSPEC',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ])
    if (process.env[name]) env[name] = process.env[name];
  return {
    ...env,
    HERMES_HOME: home,
    HERMES_RUNTIME_DIR:
      process.env.HERMES_RUNTIME_DIR || path.join(os.homedir(), '.hermes', 'tools'),
    HERMES_DISABLE_LAZY_INSTALLS: '1',
    HERMES_SOURCE: process.env.HERMES_SOURCE || path.join(os.homedir(), '.hermes', 'hermes-agent'),
    PYTHONUNBUFFERED: '1',
    NO_COLOR: '1',
    HERMES_TELEMETRY_ENABLED: 'false',
  };
}

export function stopProcess(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Already exited. */
  }
}

export class Hermes {
  executable =
    process.env.HERMES_EXECUTABLE ||
    path.join(
      os.homedir(),
      '.local',
      'bin',
      process.platform === 'win32' ? 'hermes.exe' : 'hermes',
    );
  python =
    process.env.HERMES_PYTHON ||
    [
      path.join(os.homedir(), '.hermes', 'hermes-agent', '.hermes', 'bin', 'python'),
      path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'python'),
    ].find((p) => fs.existsSync(p)) ||
    '';
  runtime: { available: boolean; version: string; error: string | null; scheduler: boolean } = {
    available: false,
    version: '',
    error: 'Checking Hermes installation…',
    scheduler: false,
  };
  running = new Map<
    string,
    {
      text: string;
      activity: string;
      title: string;
      sessionId?: string;
      finish: (error?: Error, text?: string) => void;
      completion: Promise<void>;
    }
  >();
  gateways = new Map<string, Gateway>();
  requests = new Map<
    string,
    { view: InteractiveRequest; gateway: Gateway; sessionId: string; method: string }
  >();
  ticking = new Map<string, ChildProcess>();
  timer?: ReturnType<typeof setInterval>;
  beforeRun?: (bot: Bot) => void;
  constructor(
    readonly store: Store,
    readonly changed: () => void,
  ) {}
  async probe() {
    try {
      const sharedInstalls =
        process.env.HERMES_INSTALLS_DIR || path.join(os.homedir(), '.hermes', 'installs');
      const localInstalls = path.join(this.store.home('default'), 'installs');
      if (fs.existsSync(sharedInstalls) && !fs.existsSync(localInstalls))
        fs.symlinkSync(
          sharedInstalls,
          localInstalls,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      const version = await this.command(
        this.executable,
        ['--version'],
        this.store.home('default'),
        undefined,
        30000,
      );
      if (!this.python) {
        try {
          const command = z
            .array(z.string())
            .parse(
              JSON.parse(
                await this.command(
                  this.executable,
                  ['--print-runtime-command'],
                  this.store.home('default'),
                ),
              ),
            );
          if (command[0] && fs.existsSync(command[0])) this.python = command[0];
        } catch {
          /* Older Hermes uses HERMES_PYTHON. */
        }
      }
      if (this.python) {
        try {
          const resolved = z.string().parse(await this.routines('default', 'runtime'));
          if (fs.existsSync(resolved)) this.python = resolved;
        } catch {
          /* An explicit legacy Python can already carry its dependencies. */
        }
      }
      this.runtime = {
        available: true,
        version: version.split('\n')[0],
        error: this.python
          ? null
          : 'Set HERMES_PYTHON to the Python executable in your Hermes environment to manage routines.',
        scheduler: Boolean(this.python),
      };
    } catch {
      this.runtime = {
        available: false,
        version: '',
        error:
          'Hermes was not found. Install Hermes Agent or set HERMES_EXECUTABLE, then restart this app.',
        scheduler: false,
      };
    }
    this.changed();
  }
  launcher(args: string[]) {
    const main = path.join(
      process.env.HERMES_SOURCE || path.join(os.homedir(), '.hermes', 'hermes-agent'),
      'hermes_cli',
      'main.py',
    );
    return this.python && fs.existsSync(main)
      ? { exe: this.python, args: ['-I', main, ...args] }
      : { exe: this.executable, args };
  }
  cli(args: string[], home: string, timeout = 30000) {
    const launch = this.launcher(args);
    return this.command(launch.exe, launch.args, home, undefined, timeout);
  }
  command(exe: string, args: string[], home: string, input?: string, timeout = 30000) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(exe, args, {
        env: childEnvironment(home),
        cwd: home,
        detached: process.platform !== 'win32',
        stdio: 'pipe',
      });
      let out = '';
      let overflow = false;
      const timer = setTimeout(() => {
        stopProcess(child);
        reject(new Error('Hermes timed out. Check its runtime and provider configuration.'));
      }, timeout);
      child.stdout?.on('data', (d) => {
        out += String(d);
        if (out.length > 4_000_000) {
          overflow = true;
          stopProcess(child);
        }
      });
      child.stderr?.resume();
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (overflow) reject(new Error('Hermes response exceeded the size limit.'));
        else if (code === 0) resolve(out);
        else
          reject(
            new Error(
              out.trim().startsWith('{')
                ? out.trim()
                : `Hermes exited with code ${code}. Check the isolated profile configuration.`,
            ),
          );
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
  async routines(id: string, action: string, args: Record<string, string> = {}) {
    if (!this.python) throw new Error('HERMES_PYTHON is not configured.');
    const bridge = this.bridgePath();
    const raw = await this.command(
      this.python,
      [bridge],
      this.store.home(id),
      JSON.stringify({ action, ...args, workdir: path.join(this.store.home(id), 'workspace') }),
    );
    const result = z
      .object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })
      .parse(JSON.parse(raw));
    if (!result.ok) throw new Error(result.error || 'Hermes cron operation failed');
    this.changed();
    return action === 'list' ? z.array(routineSchema).parse(result.result) : result.result;
  }
  bridgePath() {
    let bridge = fileURLToPath(new URL('./hermes_bridge.py', import.meta.url));
    if (!fs.existsSync(bridge))
      bridge = fileURLToPath(new URL('../../server/hermes_bridge.py', import.meta.url));
    if (bridge.includes('app.asar/')) bridge = bridge.replace('app.asar/', 'app.asar.unpacked/');
    return bridge;
  }
  gateway(bot: Bot) {
    const existing = this.gateways.get(bot.id);
    if (existing) return existing;
    if (!this.python)
      throw new Error('Set HERMES_PYTHON to your Hermes environment to use interactive chat.');
    const gateway = new Gateway({
      python: this.python,
      bridge: this.bridgePath(),
      home: this.store.home(bot.id),
      env: childEnvironment(this.store.home(bot.id)),
      stop: stopProcess,
      onFrame: (frame) => this.frame(bot.id, gateway, frame),
      onClose: (error) => {
        if (this.gateways.get(bot.id) !== gateway) return;
        this.gateways.delete(bot.id);
        this.clearRequests(bot.id);
        this.running.get(bot.id)?.finish(new Error(this.store.redact(bot.id, error.message)));
        this.changed();
      },
    });
    this.gateways.set(bot.id, gateway);
    return gateway;
  }
  clearRequests(id: string, sessionId?: string) {
    for (const [key, request] of this.requests)
      if (request.view.botId === id && (!sessionId || request.sessionId === sessionId))
        this.requests.delete(key);
  }
  frame(id: string, gateway: Gateway, frame: GatewayFrame) {
    if (this.gateways.get(id) !== gateway) return;
    if (frame.method === 'event') {
      const parsed = eventSchema.safeParse(frame.params);
      if (!parsed.success) return;
      const event = parsed.data;
      const payload = event.payload || {};
      const turn = this.running.get(id);
      if (event.type === 'request.cancel' && typeof payload.id === 'string') {
        this.requests.delete(payload.id);
        this.changed();
      }
      if (!turn || event.session_id !== turn.sessionId) return;
      if (event.type === 'message.delta' && typeof payload.text === 'string')
        turn.text += payload.text;
      else if (event.type === 'tool.start' && typeof payload.name === 'string') {
        turn.activity = payload.name.replaceAll('_', ' ');
        this.store.activity(
          id,
          payload.name === 'message_agent' ? 'exchange' : 'tool',
          `${payload.name} ${JSON.stringify(payload.args || {})}`,
        );
      } else if (event.type === 'tool.complete' && typeof payload.name === 'string') {
        this.store.activity(
          id,
          'tool',
          `${payload.name}: ${String(payload.summary || payload.result_text || JSON.stringify(payload.result) || 'Completed').slice(0, 4000)}`,
        );
      } else if (event.type === 'status.update' && typeof payload.text === 'string')
        turn.activity = payload.text.slice(0, 160);
      else if (event.type === 'message.complete') {
        const result = z
          .object({
            text: z.string().nullable().optional(),
            status: z.string().nullable().optional(),
            error: z.string().nullable().optional(),
          })
          .safeParse(payload);
        if (!result.success)
          return turn.finish(new Error('Hermes returned an unsupported completion.'));
        if (result.data.status === 'interrupted')
          turn.finish(
            new DOMException(
              'Turn stopped. Review the transcript for work already completed.',
              'AbortError',
            ),
          );
        else if (result.data.status === 'error')
          turn.finish(
            new Error(
              this.store.redact(
                id,
                result.data.error ||
                  result.data.text ||
                  'Turn stopped. Review the transcript for work already completed.',
              ),
            ),
          );
        else turn.finish(undefined, result.data.text || turn.text);
      } else if (event.type === 'error' && typeof payload.message === 'string')
        turn.finish(new Error(this.store.redact(id, payload.message)));
      this.changed();
      return;
    }
    if (frame.id == null || !frame.method) return;
    const identity = z.object({ session_id: z.string() }).safeParse(frame.params);
    const turn = this.running.get(id);
    if (!identity.success || !turn || identity.data.session_id !== turn.sessionId) {
      gateway.send({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32601, message: 'No active client for this request.' },
      });
      return;
    }
    const requestId = String(frame.id);
    const base = { id: requestId, botId: id, title: turn.title };
    let view: InteractiveRequest | undefined;
    if (frame.method === 'clarify') {
      const parsed = nativeQuestionSchema.safeParse(frame.params);
      if (parsed.success)
        view = {
          ...base,
          kind: 'clarify',
          questions: (
            parsed.data.questions || [
              {
                qid: 'answer',
                question: parsed.data.question || 'What would you like to do?',
                choices: parsed.data.choices,
                multi_select: parsed.data.multi_select || false,
              },
            ]
          ).map((question) => ({
            ...question,
            question: this.store.redact(id, question.question),
            choices: question.choices?.map((choice) => this.store.redact(id, choice)),
          })),
        };
    } else if (frame.method === 'approval') {
      const parsed = nativeApprovalSchema.safeParse(frame.params);
      if (parsed.success)
        view = {
          ...base,
          kind: 'approval',
          command: this.store.redact(id, parsed.data.command),
          description: this.store.redact(id, parsed.data.description),
          choices: parsed.data.choices,
        };
    } else if (frame.method === 'secret' || frame.method === 'sudo') {
      const parsed = z
        .object({
          prompt: z.string().optional(),
          env_var: z.string().optional(),
          command: z.string().optional(),
        })
        .safeParse(frame.params);
      if (parsed.success)
        view = {
          ...base,
          kind: 'secret',
          prompt: this.store.redact(
            id,
            parsed.data.prompt || `Password requested for: ${parsed.data.command || 'sudo'}`,
          ),
          envVar: parsed.data.env_var,
        };
    }
    if (!view) {
      gateway.send({
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32601, message: 'This client does not support this request.' },
      });
      this.store.activity(
        id,
        'error',
        `Hermes requested an unsupported interaction: ${frame.method}`,
      );
    } else {
      this.requests.set(requestId, {
        view,
        gateway,
        sessionId: identity.data.session_id,
        method: frame.method,
      });
      turn.activity =
        view.kind === 'approval'
          ? 'Waiting for approval'
          : view.kind === 'clarify'
            ? 'Waiting for your answer'
            : 'Waiting for a credential';
      this.store.activity(id, 'run', turn.activity);
    }
    this.changed();
  }
  respond(id: string, requestId: string, response: RequestResponse) {
    const request = this.requests.get(requestId);
    if (!request || request.view.botId !== id)
      throw new Error('This request is no longer waiting for a response.');
    const view = request.view;
    let result: Record<string, unknown>;
    if (view.kind === 'clarify' && response.kind === 'clarify') {
      if (view.questions.some((q) => !(q.qid in response.answers)))
        throw new Error('Answer every question, or skip it with an empty answer.');
      result =
        view.questions.length === 1 && view.questions[0].qid === 'answer'
          ? { answer: response.answers.answer }
          : { answers: response.answers };
    } else if (view.kind === 'approval' && response.kind === 'approval') {
      if (!view.choices.includes(response.choice))
        throw new Error('That approval scope is not available for this request.');
      result = { choice: response.choice };
    } else if (view.kind === 'secret' && response.kind === 'secret')
      result = { value: response.value };
    else throw new Error('Response does not match the pending request.');
    request.gateway.send({ jsonrpc: '2.0', id: requestId, result });
    this.requests.delete(requestId);
    this.store.activity(
      id,
      'run',
      response.kind === 'approval'
        ? `Approval decision: ${response.choice}`
        : response.kind === 'secret'
          ? 'Credential prompt answered'
          : 'Question answered',
    );
    const turn = this.running.get(id);
    if (turn) turn.activity = 'Continuing';
    this.changed();
  }
  async run(bot: Bot, text: string, title = 'Bot Chat'): Promise<string> {
    if (!this.runtime.available) throw new Error(this.runtime.error || 'Hermes is unavailable.');
    if (this.running.has(bot.id)) throw new Error('This Bot is already working.');
    this.beforeRun?.(bot);
    const gateway = this.gateway(bot);
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      let completed: () => void = () => {};
      const completion = new Promise<void>((resolve) => {
        completed = resolve;
      });
      const timeout = setTimeout(
        () => {
          void this.stop(bot.id);
        },
        15 * 60 * 1000,
      );
      const turn: {
        text: string;
        activity: string;
        title: string;
        sessionId?: string;
        completion: Promise<void>;
        finish: (error?: Error, answer?: string) => void;
      } = {
        text: '',
        activity: 'Starting',
        title,
        completion,
        finish: (error?: Error, answer?: string) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          this.running.delete(bot.id);
          this.clearRequests(bot.id, turn.sessionId);
          this.store.activity(
            bot.id,
            error && error.name !== 'AbortError' ? 'error' : 'run',
            error?.message || 'Finished',
          );
          this.changed();
          completed();
          if (error) reject(error);
          else resolve(answer || turn.text);
        },
      };
      this.running.set(bot.id, turn);
      this.store.activity(bot.id, 'run', `Started ${title}`);
      this.changed();
      void (async () => {
        await gateway.call('client.capabilities', { server_requests: true });
        let sid = gateway.sessions.get(title);
        if (!sid) {
          const existing = this.store
            .history(bot.id, title)
            .sessions.filter((s) => s.title === title || s.title.startsWith(`${title} #`))
            .at(-1);
          const response = existing
            ? await gateway.call('session.resume', { session_id: existing.id, eager_build: true })
            : await gateway.call('session.create', {
                title,
                cwd: path.join(this.store.home(bot.id), 'workspace'),
                cwd_explicit: true,
                source: 'cli',
                model: bot.provider.model,
                provider: bot.provider.kind === 'claude' ? 'anthropic' : 'custom',
                follow_profile_config: true,
              });
          sid = sessionResultSchema.parse(response).session_id;
          gateway.sessions.set(title, sid);
        }
        if (finished) return;
        turn.sessionId = sid;
        turn.activity = 'Thinking';
        this.changed();
        await gateway.call('prompt.submit', { session_id: sid, text });
      })().catch((error: unknown) => {
        if (finished) return;
        turn.finish(
          new Error(
            this.store.redact(
              bot.id,
              error instanceof Error ? error.message : 'Hermes could not start this turn.',
            ),
          ),
        );
        // A timed-out submit may still be running in Hermes. Retire that channel
        // before a new turn can receive its late events.
        if (this.gateways.get(bot.id) === gateway) this.reset(bot.id);
      });
    });
  }
  async steer(id: string, title: string, text: string) {
    const turn = this.running.get(id);
    const gateway = this.gateways.get(id);
    if (!turn?.sessionId || turn.title !== title || !gateway)
      throw new Error('This conversation has no running turn to steer.');
    const result = z
      .object({ status: z.enum(['queued', 'redirected', 'rejected']) })
      .parse(await gateway.call('session.steer', { session_id: turn.sessionId, text }));
    if (result.status === 'rejected')
      throw new Error(
        'The turn can no longer accept steering. Send your message when it finishes.',
      );
    this.store.activity(id, 'run', 'Steering queued for the next tool result');
    this.changed();
    return result;
  }
  async stop(id: string) {
    const turn = this.running.get(id);
    const gateway = this.gateways.get(id);
    if (!turn) return;
    if (gateway && turn.sessionId) {
      try {
        const interrupt = gateway.call('session.interrupt', { session_id: turn.sessionId });
        // Wait for the native terminal event before admitting another turn in this session.
        const deadline = setTimeout(() => this.reset(id), 5000);
        try {
          await interrupt;
          await turn.completion;
        } finally {
          clearTimeout(deadline);
        }
      } catch {
        this.reset(id);
      }
    } else this.reset(id);
  }
  reset(id: string) {
    const gateway = this.gateways.get(id);
    this.gateways.delete(id);
    this.clearRequests(id);
    if (gateway) stopProcess(gateway.child);
    this.running
      .get(id)
      ?.finish(new Error('Hermes session disconnected. Send another message to reconnect.'));
  }
  startScheduler() {
    const tick = () => {
      if (!this.runtime.scheduler) return;
      for (const bot of this.store.state.bots) {
        if (this.ticking.has(bot.id)) continue;
        const file = path.join(this.store.home(bot.id), 'cron', 'jobs.json');
        if (!fs.existsSync(file)) continue;
        const launch = this.launcher(['cron', 'tick']);
        const child = spawn(launch.exe, launch.args, {
          env: childEnvironment(this.store.home(bot.id)),
          cwd: this.store.home(bot.id),
          detached: process.platform !== 'win32',
          stdio: 'ignore',
        });
        this.ticking.set(bot.id, child);
        child.on('error', () => this.ticking.delete(bot.id));
        child.on('close', (code) => {
          this.ticking.delete(bot.id);
          if (code && code !== 0)
            this.store.activity(
              bot.id,
              'error',
              'Hermes scheduler tick failed. Check Hermes cron status for this profile.',
            );
          this.changed();
        });
      }
    };
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
    tick();
  }
  async close() {
    clearInterval(this.timer);
    const children: ChildProcess[] = [...this.gateways.values()].map((gateway) => gateway.child);
    children.push(...this.ticking.values());
    const exits = children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 3000);
          child.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    );
    for (const id of this.gateways.keys()) this.reset(id);
    for (const child of this.ticking.values()) stopProcess(child);
    await Promise.all(exits);
  }
}
