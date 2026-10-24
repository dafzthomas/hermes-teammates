import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';

const frameSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
export type GatewayFrame = z.infer<typeof frameSchema>;

/** One private stdio channel to the native Hermes gateway. No listening port. */
export class Gateway {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  readonly sessions = new Map<string, string>();
  private sequence = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private stopped = false;
  private diagnostics = '';

  constructor(options: {
    python: string;
    bridge: string;
    home: string;
    env: NodeJS.ProcessEnv;
    onFrame: (frame: GatewayFrame) => void;
    onClose: (error: Error) => void;
    stop: (child: ChildProcessWithoutNullStreams) => void;
  }) {
    const child = (this.child = spawn(options.python, [options.bridge, '--gateway'], {
      cwd: options.home,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    }));
    let readyResolve: () => void;
    let readyReject: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const readyTimer = setTimeout(
      () => fail(new Error('Hermes gateway startup timed out.')),
      60000,
    );
    const fail = (error: Error) => {
      if (this.stopped) return;
      this.stopped = true;
      clearTimeout(readyTimer);
      readyReject(error);
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.reject(error);
      }
      this.pending.clear();
      options.stop(child);
      options.onClose(error);
    };
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      buffer += data;
      if (buffer.length > 4_000_000)
        return fail(new Error('Hermes gateway frame exceeded the size limit.'));
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          this.diagnostics = (this.diagnostics + line).slice(-8000);
          continue;
        }
        const parsed = frameSchema.safeParse(raw);
        if (!parsed.success) continue;
        const frame = parsed.data;
        if (!frame.method && frame.id != null) {
          const call = this.pending.get(String(frame.id));
          if (call) {
            this.pending.delete(String(frame.id));
            clearTimeout(call.timer);
            if (frame.error) call.reject(new Error(frame.error.message));
            else call.resolve(frame.result);
          }
        } else {
          if (
            frame.method === 'event' &&
            z.object({ type: z.literal('gateway.ready') }).safeParse(frame.params).success
          ) {
            clearTimeout(readyTimer);
            readyResolve();
          }
          options.onFrame(frame);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      this.diagnostics = (this.diagnostics + data).slice(-8000);
    });
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('close', () =>
      fail(
        new Error('Hermes gateway closed. Send another message to reconnect.', {
          cause: this.diagnostics,
        }),
      ),
    );
  }
  send(frame: GatewayFrame) {
    if (this.stopped) throw new Error('Hermes gateway is disconnected.');
    this.child.stdin.write(JSON.stringify(frame) + '\n');
  }
  async call(method: string, params: Record<string, unknown>) {
    await this.ready;
    const id = `client-${++this.sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hermes ${method} timed out.`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}
