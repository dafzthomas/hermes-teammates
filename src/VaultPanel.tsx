import { useEffect, useState, useCallback } from 'react';
import { LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { api } from './api';
import { loginInputSchema, vaultSnapshotSchema, type VaultSnapshot } from './vault';
import type { Editor } from './editor';

function LoginFields() {
  return (
    <>
      <label>
        Login label
        <input name="label" required maxLength={100} placeholder="e.g. Project account" autoFocus />
      </label>
      <label>
        Website URL
        <input name="origin" type="url" required placeholder="https://example.com" />
        <small>The login is bound to this exact site origin, including its port.</small>
      </label>
      <label>
        Identifier type
        <select name="identifierType">
          <option value="email">Email</option>
          <option value="username">Username</option>
          <option value="phone">Phone</option>
        </select>
      </label>
      <label>
        Email, username or phone
        <input name="identifier" required maxLength={320} autoComplete="off" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          maxLength={16000}
          autoComplete="new-password"
        />
      </label>
      <label>
        Authenticator setup key, optional
        <input name="otpSecret" type="password" maxLength={2048} autoComplete="off" />
        <small>A base32 setup key or otpauth URL. Leave empty for a one-time code prompt.</small>
      </label>
      <p className="form-note">
        Saved in this Bot’s native Hermes login vault. The password and authenticator key are
        encrypted; the site and identifier are visible metadata.
      </p>
    </>
  );
}
export function VaultPanel({
  botId,
  botName,
  edit,
}: {
  botId: string;
  botName: string;
  edit: (editor: Editor) => void;
}) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `/bots/${botId}/vault`;
  const refresh = useCallback(async () => {
    const result = vaultSnapshotSchema.parse(await api(url));
    setSnapshot(result);
    setError('');
  }, [url]);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      void api(url)
        .then((value) => {
          if (alive) {
            setSnapshot(vaultSnapshotSchema.parse(value));
            setError('');
          }
        })
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : 'Cannot load saved logins.');
        });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url]);
  async function mutate(endpoint: string, body?: unknown, method?: string) {
    setBusy(true);
    setError('');
    try {
      await api(url + endpoint, body, method);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update login vault.');
    } finally {
      setBusy(false);
    }
  }
  const logins = snapshot?.items.filter((item) => item.kind === 'login') || [];
  return (
    <section className="vault-panel" aria-label={`${botName} saved logins`}>
      <div className="section-heading">
        <h3>
          <LockKeyhole size={16} />
          Passwords &amp; logins
        </h3>
        <button
          disabled={!snapshot || busy}
          onClick={() =>
            edit({
              title: 'Add saved login',
              body: <LoginFields />,
              button: 'Save login',
              submit: async (data) => {
                const login = loginInputSchema.parse(Object.fromEntries(data));
                await api(url + '/logins', login);
                await refresh();
              },
            })
          }
        >
          <Plus size={14} />
          Add login
        </button>
      </div>
      <p className="panel-description">
        Native Hermes browser tools can use these logins without putting their passwords in model
        prompts. This does not fill the separate Computer VM.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!snapshot && !error && <p className="panel-description">Loading login vault…</p>}
      {snapshot && !logins.length && (
        <p className="vault-empty">No saved website logins for this Bot.</p>
      )}
      {logins.map((item) => (
        <div className="vault-item" key={item.id}>
          <LockKeyhole size={16} />
          <span>
            <strong>{item.label}</strong>
            <small>{item.origin}</small>
            <small>
              {item.identifier} · {item.backend}
              {item.has_otp ? ' · 2FA auto' : ''}
            </small>
          </span>
          {item.backend === 'local' && (
            <button
              aria-label={`Remove login ${item.label}`}
              disabled={busy}
              onClick={() =>
                edit({
                  title: 'Remove saved login',
                  body: (
                    <p>
                      Remove {item.label} from {botName}’s encrypted vault? A browser may remain
                      signed in until its site session ends.
                    </p>
                  ),
                  button: 'Remove login',
                  submit: async () => {
                    await api(`${url}/logins/${encodeURIComponent(item.id)}`, undefined, 'DELETE');
                    await refresh();
                  },
                })
              }
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {snapshot && (
        <>
          <div className="section-heading vault-sources-heading">
            <h4>Login sources</h4>
            <button disabled={busy} onClick={() => void mutate('/lock', {})}>
              Lock managers
            </button>
          </div>
          {snapshot.sources.map((source) => (
            <div className="vault-source" key={source.name}>
              <span>
                <strong>{source.display_name}</strong>
                <small>
                  {source.name === 'local'
                    ? 'Encrypted files in this Bot’s profile'
                    : !source.installed
                      ? 'CLI not installed'
                      : !source.enabled
                        ? 'Disabled for this Bot'
                        : source.unlocked
                          ? 'Unlocked'
                          : 'Locked; Hermes will ask privately when needed'}
                </small>
              </span>
              {source.name !== 'local' && (
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Enable ${source.display_name} for ${botName}`}
                    checked={source.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      void mutate(
                        `/sources/${source.name}`,
                        { enabled: event.target.checked },
                        'PUT',
                      )
                    }
                  />
                </label>
              )}
            </div>
          ))}
          <p className="form-note">
            External managers can make their saved logins available to this Bot after unlock. The
            local vault uses encrypted files and a local 0600 key; it is not an OS Keychain.
          </p>
        </>
      )}
    </section>
  );
}
