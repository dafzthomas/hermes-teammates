import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { routineSchema, type Bot } from '../src/domain';
import { Store } from './store';

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('system'), session_id: z.string().optional() }),
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    name: z.string(),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    name: z.string(),
    output: z.string().optional(),
    is_error: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('result'),
    text: z.string(),
    exit_code: z.number(),
    error: z.string().optional(),
  }),
]);

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
    { child: ChildProcess; text: string; activity: string; title: string; cancelled: boolean }
  >();
  ticking = new Map<string, ChildProcess>();
  timer?: ReturnType<typeof setInterval>;
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
    let bridge = fileURLToPath(new URL('./hermes_bridge.py', import.meta.url));
    if (!fs.existsSync(bridge))
      bridge = fileURLToPath(new URL('../../server/hermes_bridge.py', import.meta.url));
    if (bridge.includes('app.asar/')) bridge = bridge.replace('app.asar/', 'app.asar.unpacked/');
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
  async run(bot: Bot, text: string, title = 'Bot Chat'): Promise<string> {
    if (!this.runtime.available) throw new Error(this.runtime.error || 'Hermes is unavailable.');
    if (this.running.has(bot.id))
      throw new Error('This Bot is working. Wait for it or stop the current turn.');
    const args = [
      'chat',
      '--query-file',
      '-',
      '--format',
      'stream-json',
      '--continue',
      title,
      '--create-if-missing',
      '--provider',
      bot.provider.kind === 'claude' ? 'anthropic' : 'custom',
      '--model',
      bot.provider.model,
      '--in',
      path.join(this.store.home(bot.id), 'workspace'),
    ];
    const launch = this.launcher(args);
    const child = spawn(launch.exe, launch.args, {
      env: childEnvironment(this.store.home(bot.id)),
      cwd: this.store.home(bot.id),
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    });
    const turn = { child, text: '', activity: 'Thinking', title, cancelled: false };
    this.running.set(bot.id, turn);
    this.changed();
    this.store.activity(bot.id, 'run', `Started ${title}`);
    return new Promise((resolve, reject) => {
      let finished = false;
      let diagnostics = '';
      let buffer = '';
      let result: { text: string; exit_code: number; error?: string } | undefined;
      const timeout = setTimeout(
        () => {
          turn.cancelled = true;
          stopProcess(child);
        },
        15 * 60 * 1000,
      );
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        this.running.delete(bot.id);
        this.changed();
        if (error) {
          this.store.activity(bot.id, 'error', error.message);
          reject(error);
        } else resolve(result?.text || turn.text);
      };
      child.stdout?.on('data', (data) => {
        buffer += String(data);
        if (buffer.length > 2_000_000) {
          turn.cancelled = true;
          stopProcess(child);
          return;
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            diagnostics = (diagnostics + line + '\n').slice(-8000);
            continue;
          }
          const parsed = eventSchema.safeParse(raw);
          if (!parsed.success) continue;
          const event = parsed.data;
          if (event.type === 'text') turn.text += event.text;
          else if (event.type === 'tool_use') {
            turn.activity = event.name.replaceAll('_', ' ');
            this.store.activity(
              bot.id,
              event.name === 'message_agent' ? 'exchange' : 'tool',
              `${event.name}${event.input ? ` ${JSON.stringify(event.input)}` : ''}`,
            );
          } else if (event.type === 'tool_result')
            this.store.activity(
              bot.id,
              event.is_error ? 'error' : 'tool',
              `${event.name}: ${(event.output || 'Completed').slice(0, 4000)}`,
            );
          else if (event.type === 'result') result = event;
          this.changed();
        }
      });
      child.stderr?.on('data', (data) => {
        diagnostics = (diagnostics + String(data)).slice(-8000);
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (turn.cancelled)
          return finish(
            new Error('Turn stopped. Review the transcript for any work already completed.'),
          );
        if (code !== 0 || !result || result.exit_code !== 0)
          return finish(
            new Error(
              this.store.redact(
                bot.id,
                result?.error ||
                  result?.text ||
                  'Hermes could not finish. Open Bot settings to check the model and credentials.',
              ),
              { cause: this.store.redact(bot.id, diagnostics) },
            ),
          );
        this.store.activity(bot.id, 'run', 'Finished');
        finish();
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(text);
    });
  }
  stop(id: string) {
    const turn = this.running.get(id);
    if (turn) {
      turn.cancelled = true;
      stopProcess(turn.child);
    }
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
  close() {
    clearInterval(this.timer);
    for (const id of this.running.keys()) this.stop(id);
    for (const child of this.ticking.values()) stopProcess(child);
  }
}
