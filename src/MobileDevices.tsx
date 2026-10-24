import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from './api';
const schema = z.object({
  enabled: z.boolean(),
  url: z.string().nullable(),
  devices: z.array(z.object({ id: z.string(), name: z.string(), expiresAt: z.number() })),
});
export function MobileDevices() {
  const [state, setState] = useState<z.infer<typeof schema>>();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  async function refresh() {
    setState(schema.parse(await api('/mobile/devices')));
  }
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh();
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : 'Could not load devices.');
      }
      if (open && !stopped) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open]);
  return (
    <details className="mobile-devices" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Mobile devices</summary>
      <p>Pair your iOS or Android app with this host.</p>
      {state?.enabled ? (
        <>
          <p>
            Host: <code>{state.url}</code>
          </p>
          <button
            onClick={() =>
              void api('/mobile/pairings', {})
                .then((v) =>
                  setPairing(z.object({ code: z.string(), expiresAt: z.number() }).parse(v)),
                )
                .catch((e: Error) => setError(e.message))
            }
          >
            Create pairing code
          </button>
          {pairing && (
            <div>
              <p>
                Enter this one-use code on your phone. Expires at{' '}
                {new Date(pairing.expiresAt).toLocaleTimeString()}.
              </p>
              <code className="pair-code">{pairing.code}</code>
              <p>Anyone with this code can access your Bots. Share it only with your own device.</p>
            </div>
          )}
        </>
      ) : (
        <p>Enable the separate HTTPS gateway first. Follow docs/mobile.md in the repository.</p>
      )}
      {state?.devices.map((d) => (
        <div key={d.id}>
          <span>{d.name}</span>
          <button
            onClick={() =>
              void api(`/mobile/devices/${d.id}`, undefined, 'DELETE')
                .then(refresh)
                .catch((e: Error) => setError(e.message))
            }
          >
            Revoke {d.name}
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
