import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { z } from 'zod';
import { Store } from './store';
import { computerActionSchema, type Bot, type ComputerStatus } from '../src/domain';

export function serverResource(name: string) {
  let resource = fileURLToPath(new URL(name, import.meta.url));
  if (!fs.existsSync(resource))
    resource = fileURLToPath(new URL(`../../server/${name}`, import.meta.url));
  return resource.replace('app.asar/', 'app.asar.unpacked/');
}
const machineSchema = z.object({ password: z.string() });
const inspectSchema = z.array(
  z.object({
    configuration: z.object({
      id: z.string(),
      labels: z.record(z.string(), z.string()).optional(),
    }),
    status: z.object({
      state: z.string(),
      networks: z.array(z.object({ ipv4Address: z.string().optional() })).optional(),
    }),
  }),
);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** App-owned Apple VMs. Only named volumes enter the guest; no host paths or provider keys. */
export class Computers {
  readonly binary =
    process.env.TEAMMATES_CONTAINER ||
    ['/opt/homebrew/bin/container', '/usr/local/bin/container'].find((p) => fs.existsSync(p));
  readonly namespace: string;
  readonly image: string;
  private origin = '';
  private imageReady?: Promise<void>;
  private waking = new Map<string, Promise<ComputerStatus>>();
  private states = new Map<string, ComputerStatus>();
  private tokens = new Map<string, string>();
  private machines = new Map<string, z.infer<typeof machineSchema>>();
  private activity = new Map<string, number>();
  private activeActions = new Map<string, Promise<unknown>>();
  private idleTimer: ReturnType<typeof setInterval>;
  private closing = false;
  private children = new Set<ChildProcess>();
  constructor(
    readonly store: Store,
    readonly changed: () => void,
  ) {
    this.namespace = createHash('sha256').update(store.root).digest('hex').slice(0, 12);
    const hash = createHash('sha256');
    for (const file of ['Containerfile', 'start.sh'])
      hash.update(fs.readFileSync(path.join(serverResource('computer'), file)));
    this.image = `teammates-computer:${hash.digest('hex').slice(0, 12)}`;
    this.idleTimer = setInterval(() => {
      for (const [id, at] of this.activity)
        if (
          Date.now() - at > 20 * 60 * 1000 &&
          this.states.get(id)?.control !== 'human' &&
          !this.activeActions.has(id)
        )
          void this.sleep(id).catch(() => {});
    }, 60000);
    this.idleTimer.unref();
  }
  bindOrigin(origin: string) {
    this.origin = origin;
  }
  name(id: string) {
    this.store.bot(id);
    return `teammates-${this.namespace}-${id}`;
  }
  recordPath(id: string) {
    return path.join(this.store.home(id), '.computer-machine.json');
  }
  patch(id: string, patch: Partial<ComputerStatus>) {
    const state: ComputerStatus = {
      ...(this.states.get(id) || {
        state: 'off',
        control: 'bot',
        error: null,
        installed: Boolean(this.binary),
        enabled: this.store.bot(id).computerEnabled,
      }),
      enabled: this.store.bot(id).computerEnabled,
      installed: Boolean(this.binary),
      ...patch,
    };
    const previous = this.states.get(id);
    this.states.set(id, state);
    if (JSON.stringify(previous) !== JSON.stringify(state)) this.changed();
    return state;
  }
  async command(args: string[], input?: string, timeout = 30000) {
    const binary = this.binary;
    if (!binary)
      throw new Error(
        'Install Apple container, then run container system start. Computers require macOS 26+ on Apple silicon.',
      );
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['HOME', 'PATH', 'USER', 'TMPDIR', 'LANG'])
      if (process.env[key]) env[key] = process.env[key];
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(binary, args, { env, stdio: 'pipe' });
      this.children.add(child);
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Computer operation timed out.'));
      }, timeout);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8_000_000) child.kill('SIGKILL');
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        this.children.delete(child);
        clearTimeout(timer);
        if (code === 0 && bytes <= 8_000_000) resolve(Buffer.concat(chunks));
        else {
          for (const machine of this.machines.values())
            stderr = stderr.split(machine.password).join('[screen credential]');
          reject(
            new Error(
              stderr.trim() ||
                `Computer operation failed (${code}). Check container system status.`,
            ),
          );
        }
      });
    });
  }
  async inspect(id: string) {
    const raw = await this.command(['list', '--all', '--format', 'json']);
    const machines = inspectSchema.parse(JSON.parse(raw.toString()));
    return machines.find((machine) => machine.configuration.id === this.name(id));
  }
  async status(id: string) {
    const bot = this.store.bot(id);
    if (!bot.computerEnabled || !this.binary)
      return this.patch(id, {
        state: 'off',
        installed: Boolean(this.binary),
        enabled: bot.computerEnabled,
      });
    if (this.waking.has(id)) return this.patch(id, {});
    try {
      const machine = await this.inspect(id);
      return this.patch(id, {
        state: machine?.status.state === 'running' ? 'running' : machine ? 'sleeping' : 'off',
        error: null,
      });
    } catch (error) {
      return this.patch(id, {
        state: 'error',
        error: error instanceof Error ? error.message : 'Container service is unavailable.',
      });
    }
  }
  configure(bot: Bot, python: string) {
    const configPath = path.join(this.store.home(bot.id), 'config.yaml');
    const config = z
      .record(z.string(), z.unknown())
      .parse(YAML.parse(fs.readFileSync(configPath, 'utf8')));
    const parsedServers = z.record(z.string(), z.unknown()).safeParse(config.mcp_servers);
    const servers = parsedServers.success ? parsedServers.data : {};
    if (bot.computerEnabled) {
      if (!this.origin || !python)
        throw new Error('Computer tools need the running local backend and Hermes Python.');
      const token = this.tokens.get(bot.id) || randomBytes(32).toString('hex');
      this.tokens.set(bot.id, token);
      const descriptor = path.join(this.store.home(bot.id), '.teammates-computer.json');
      this.store.atomic(
        descriptor,
        JSON.stringify({ url: `${this.origin}/api/bots/${bot.id}/computer-tools`, token }),
      );
      servers['teammates-computer'] = {
        command: python,
        args: ['-I', serverResource('computer_mcp.py'), descriptor],
        timeout: 180,
      };
    } else delete servers['teammates-computer'];
    config.mcp_servers = servers;
    this.store.atomic(configPath, YAML.stringify(config));
  }
  authorized(id: string, bearer: string | undefined) {
    const expected = this.tokens.get(id);
    const supplied = bearer?.replace(/^Bearer /, '') || '';
    return Boolean(
      expected &&
      Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
    );
  }
  private machine(id: string) {
    let machine = this.machines.get(id);
    if (!machine && fs.existsSync(this.recordPath(id))) {
      machine = machineSchema.parse(JSON.parse(fs.readFileSync(this.recordPath(id), 'utf8')));
      this.machines.set(id, machine);
    }
    if (!machine) throw new Error('Start this computer first.');
    return machine;
  }
  private async ensureImage() {
    this.imageReady ||= this.command(['image', 'inspect', this.image])
      .then(() => {})
      .catch(async () => {
        await this.command(
          [
            'build',
            '-t',
            this.image,
            '-f',
            path.join(serverResource('computer'), 'Containerfile'),
            serverResource('computer'),
          ],
          undefined,
          20 * 60 * 1000,
        );
      })
      .catch((error: unknown) => {
        this.imageReady = undefined;
        throw error;
      });
    await this.imageReady;
  }
  wake(id: string) {
    if (!this.store.bot(id).computerEnabled) throw new Error('Enable this Bot’s computer first.');
    if (this.closing) throw new Error('The computer service is shutting down.');
    const pending = this.waking.get(id);
    if (pending) return pending;
    if (this.states.get(id)?.state !== 'running')
      this.patch(id, { state: 'starting', error: null });
    const waking = this.start(id)
      .catch((error: unknown) => {
        this.patch(id, {
          state: 'error',
          error: error instanceof Error ? error.message : 'Could not start computer.',
        });
        throw error;
      })
      .finally(() => this.waking.delete(id));
    this.waking.set(id, waking);
    return waking;
  }
  private async start(id: string) {
    let existing = await this.inspect(id);
    if (
      existing &&
      existing.configuration.labels?.['org.hermesteammates.workspace'] !== this.namespace
    )
      throw new Error('Computer name is owned by another workspace.');
    if (existing && !fs.existsSync(this.recordPath(id)))
      throw new Error('Computer state is missing. Restore its workspace data before starting it.');
    const alreadyRunning = existing?.status.state === 'running';
    if (existing && existing.status.state !== 'running')
      await this.command(['start', this.name(id)], undefined, 60000);
    if (!existing) {
      await this.ensureImage();
      const machine = { password: randomBytes(6).toString('base64url') };
      this.machines.set(id, machine);
      this.store.atomic(this.recordPath(id), JSON.stringify(machine));
      try {
        await this.command(['volume', 'create', this.name(id)]);
      } catch {
        /* A preserved home volume may already exist. */
      }
      await this.command(
        [
          'run',
          '--rm',
          '--user',
          'root',
          '--volume',
          `${this.name(id)}:/home/bot`,
          this.image,
          'chown',
          'bot:bot',
          '/home/bot',
        ],
        undefined,
        120000,
      );
      await this.command(
        [
          'run',
          '--detach',
          '--name',
          this.name(id),
          '--cpus',
          '2',
          '--memory',
          '2G',
          '--label',
          `org.hermesteammates.workspace=${this.namespace}`,
          '--volume',
          `${this.name(id)}:/home/bot`,
          '--env',
          `VNC_PASSWORD=${machine.password}`,
          this.image,
        ],
        undefined,
        120000,
      );
      await this.command([
        'exec',
        '--user',
        'root',
        this.name(id),
        'chown',
        'bot:bot',
        '/home/bot',
      ]);
      existing = await this.inspect(id);
    }
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      if (this.closing) throw new Error('Computer startup cancelled during shutdown.');
      try {
        await this.command(
          [
            'exec',
            this.name(id),
            'sh',
            '-c',
            'xdpyinfo -display :0 >/dev/null 2>&1 && xdotool search --onlyvisible --class chromium >/dev/null && test -d /home/bot/workspace',
          ],
          undefined,
          5000,
        );
        const host = await this.screenHost(id);
        await fetch(`http://${host}:6080`, { signal: AbortSignal.timeout(1500) });
        ready = true;
        break;
      } catch {
        await delay(300);
      }
    }
    if (!ready)
      throw new Error(
        'The VM started but its desktop did not become ready. Check its container logs.',
      );
    this.activity.set(id, Date.now());
    if (!alreadyRunning) this.store.activity(id, 'run', 'Computer started');
    return this.patch(id, { state: 'running', error: null });
  }
  private async screenHost(id: string) {
    const info = await this.inspect(id);
    if (info?.configuration.labels?.['org.hermesteammates.workspace'] !== this.namespace)
      throw new Error('Computer is not owned by this workspace.');
    const host = info.status.networks
      ?.find((network) => network.ipv4Address)
      ?.ipv4Address?.split('/')[0];
    if (!host || net.isIP(host) !== 4) throw new Error('Computer network is not ready.');
    return host;
  }
  async view(id: string) {
    if ((await this.status(id)).state !== 'running') throw new Error('Wake this computer first.');
    this.activity.set(id, Date.now());
    return {
      ...this.machine(id),
      host: await this.screenHost(id),
      control: this.states.get(id)?.control || 'bot',
    };
  }
  async control(id: string, human: boolean) {
    if (human) {
      await this.wake(id);
      this.patch(id, { control: 'human' });
      await this.activeActions.get(id)?.catch(() => {});
    } else this.patch(id, { control: 'bot' });
    this.activity.set(id, Date.now());
    this.store.activity(
      id,
      'run',
      human ? 'You took over the computer' : 'Computer handed back to Bot',
    );
    return this.patch(id, {});
  }
  async sleep(id: string, force = false) {
    if (!force && this.states.get(id)?.control === 'human')
      throw new Error('Hand the computer back before putting it to sleep.');
    await this.waking.get(id)?.catch(() => {});
    await this.activeActions.get(id)?.catch(() => {});
    const info = await this.inspect(id);
    if (info && info.configuration.labels?.['org.hermesteammates.workspace'] !== this.namespace)
      throw new Error('Computer is not owned by this workspace.');
    if (info?.status.state === 'running') await this.command(['stop', this.name(id)]);
    this.activity.delete(id);
    return this.patch(id, { state: info ? 'sleeping' : 'off', control: 'bot' });
  }
  async tool(id: string, name: string, input: unknown) {
    const previous = this.activeActions.get(id) || Promise.resolve();
    const action = previous
      .catch(() => {})
      .then(async () => {
        if (this.states.get(id)?.control === 'human')
          throw new Error('human_has_control: wait for the user to hand the computer back.');
        await this.wake(id);
        if (this.states.get(id)?.control === 'human') throw new Error('human_has_control');
        this.activity.set(id, Date.now());
        if (name === 'screenshot') {
          const png = await this.command([
            'exec',
            this.name(id),
            'import',
            '-window',
            'root',
            'png:-',
          ]);
          return { image: png.toString('base64') };
        }
        if (name === 'shell') {
          const { command } = z.object({ command: z.string().min(1).max(20000) }).parse(input);
          const output = await this.command(
            ['exec', '--workdir', '/home/bot/workspace', this.name(id), 'bash', '-lc', command],
            undefined,
            120000,
          );
          return { output: output.toString().slice(0, 60000) };
        }
        if (name !== 'action') throw new Error('Unknown computer tool.');
        const action = computerActionSchema.parse(input);
        const at = 'x' in action ? ['mousemove', '--sync', String(action.x), String(action.y)] : [];
        let args: string[];
        switch (action.type) {
          case 'click':
            args = [...at, 'click', action.button === 'right' ? '3' : '1'];
            break;
          case 'type':
            args = ['type', '--clearmodifiers', '--delay', '1', '--', action.text];
            break;
          case 'key':
            args = ['key', '--clearmodifiers', '--', action.key];
            break;
          case 'scroll':
            args = [
              ...at,
              'click',
              '--repeat',
              String(action.amount),
              action.direction === 'up' ? '4' : '5',
            ];
            break;
          case 'move':
            args = at;
            break;
        }
        await this.command(['exec', this.name(id), 'xdotool', ...args]);
        this.store.activity(
          id,
          'tool',
          `Computer ${action.type}${'x' in action ? ` at ${action.x}, ${action.y}` : ''}`,
        );
        return { ok: true };
      });
    this.activeActions.set(id, action);
    try {
      return await action;
    } finally {
      if (this.activeActions.get(id) === action) this.activeActions.delete(id);
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.idleTimer);
    for (const child of this.children) child.kill('SIGTERM');
    await Promise.allSettled([...this.states.keys()].map((id) => this.sleep(id, true)));
  }
}
