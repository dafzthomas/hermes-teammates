import { useEffect, useRef, useState } from 'react';
import type RFB from '@novnc/novnc';
import { Monitor, MousePointer2, Moon, Play, RotateCcw } from 'lucide-react';
import { z } from 'zod';
import { computerStatusSchema, type Bot, type ComputerStatus } from './domain';

async function request(id: string, endpoint = '', body?: unknown) {
  const response = await fetch(`/api/bots/${id}/computer${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : 'Computer request failed.');
  }
  return value;
}
export function ComputerPanel({ bot }: { bot: Bot }) {
  const [status, setStatus] = useState<ComputerStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [retry, setRetry] = useState(0);
  const screen = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  const human = status?.control === 'human';
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void request(bot.id)
        .then((value) => {
          if (alive) setStatus(computerStatusSchema.parse(value));
        })
        .catch((e) => {
          if (alive) setError(String(e.message));
        });
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bot.id]);
  useEffect(() => {
    if (status?.state !== 'running' || !screen.current) return;
    let alive = true;
    let disconnected = false;
    void Promise.all([request(bot.id, '/view'), import('@novnc/novnc')])
      .then(([value, { default: RFB }]) => {
        if (!alive || !screen.current) return;
        const view = z.object({ path: z.string(), password: z.string() }).parse(value);
        const rfb = new RFB(
          screen.current,
          `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${view.path}`,
          { credentials: { password: view.password, username: '', target: '' } },
        );
        client.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.viewOnly = true;
        rfb.addEventListener('connect', () => {
          if (alive) {
            setConnected(true);
            setError('');
          }
        });
        rfb.addEventListener('disconnect', () => {
          disconnected = true;
          if (alive) {
            setConnected(false);
            setError('Screen disconnected. Reconnect to keep watching.');
          }
        });
      })
      .catch((e) => {
        if (alive) setError(String(e.message));
      });
    return () => {
      alive = false;
      if (!disconnected) client.current?.disconnect();
      client.current = null;
      setConnected(false);
    };
  }, [bot.id, status?.state, retry]);
  useEffect(() => {
    if (client.current) client.current.viewOnly = !human || busy;
  }, [human, busy, connected]);
  async function act(endpoint: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(bot.id, endpoint, body);
      setStatus(computerStatusSchema.parse(await request(bot.id)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Computer operation failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="computer-panel" aria-label={`${bot.name} computer`}>
      <div className="computer-toolbar">
        <span>
          <span className={`computer-dot ${connected ? 'online' : ''}`} />
          {status?.state === 'running'
            ? human
              ? 'You have control'
              : `${bot.name}’s computer`
            : 'Bot computer'}
        </span>
        <div>
          {status?.state === 'running' && (
            <>
              <button disabled={busy} onClick={() => void act('/control', { human: !human })}>
                <MousePointer2 size={14} />
                {human ? 'Hand back' : 'Take control'}
              </button>
              <button
                title="Reconnect screen"
                aria-label="Reconnect screen"
                onClick={() => setRetry((v) => v + 1)}
              >
                <RotateCcw size={14} />
              </button>
              <button disabled={busy || human} onClick={() => void act('/sleep', {})}>
                <Moon size={14} />
                Sleep
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="computer-error" role="alert">
          {error}
        </div>
      )}
      {status?.state === 'running' ? (
        <>
          <div ref={screen} className="computer-screen" data-testid="computer-screen" />
          <p className="computer-caption">
            {human
              ? 'Click the screen to use the browser and desktop. Bot computer tools wait until you hand back.'
              : 'Watching live. Take control to use the keyboard and mouse.'}
          </p>
        </>
      ) : (
        <div className="computer-empty">
          <span className="computer-illustration">
            <Monitor size={48} strokeWidth={1} />
          </span>
          <h2>A computer for {bot.name}</h2>
          <p>
            A private Linux desktop with Chromium, a terminal and a persistent home. Watch your Bot
            work, or take over whenever you need to.
          </p>
          {!status ? (
            <p>Checking computer…</p>
          ) : !status.installed ? (
            <>
              <p>Requires Apple silicon and macOS 26 or later.</p>
              <code>
                brew install container
                <br />
                container system start
              </code>
              <p>Install Apple’s open source container runtime, then restart this app.</p>
            </>
          ) : status.state === 'starting' ? (
            <>
              <span className="status-pulse" />
              <p>
                Starting the desktop… The first start builds a Linux image and may take several
                minutes.
              </p>
            </>
          ) : (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (!status.enabled && !(await act('/enable', { enabled: true }))) return;
                  await act('/wake', {});
                })()
              }
            >
              <Play size={16} />
              {status.enabled ? 'Wake computer' : 'Set up computer'}
            </button>
          )}
          {status?.error && <p className="computer-error">{status.error}</p>}
          <small>
            20 minutes idle puts the computer to sleep. Its files and browser profile stay here.
          </small>
        </div>
      )}
    </section>
  );
}
