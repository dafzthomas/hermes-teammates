import { useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { InteractiveRequest, RequestResponse } from './domain';

type VaultRequest = Extract<
  InteractiveRequest,
  { kind: 'vault_login' | 'vault_unlock' | 'vault_code' }
>;
export function VaultRequestCard({
  request,
  botName,
  respond,
}: {
  request: VaultRequest;
  botName: string;
  respond: (response: RequestResponse) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function answer(response: RequestResponse) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await respond(response);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send private response.');
      setBusy(false);
    }
  }
  function skip() {
    void answer(
      request.kind === 'vault_login'
        ? { kind: 'vault_login', login: null }
        : { kind: request.kind, value: '' },
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = String(data.get('value') || '');
    event.currentTarget.reset();
    if (request.kind === 'vault_login')
      void answer({
        kind: 'vault_login',
        login: { identifier: String(data.get('identifier') || ''), password: value },
      });
    else void answer({ kind: request.kind, value });
  }
  const title =
    request.kind === 'vault_login'
      ? 'Save website login'
      : request.kind === 'vault_unlock'
        ? `Unlock ${request.displayName}`
        : `Verification code for ${request.site}`;
  return (
    <section
      className="request-card vault-request"
      aria-label={`${botName} ${request.kind === 'vault_login' ? 'login request' : request.kind === 'vault_unlock' ? 'vault unlock request' : 'verification code request'}`}
    >
      <header>
        <LockKeyhole size={18} />
        <strong>{title}</strong>
        <span>{botName}</span>
      </header>
      {request.kind === 'vault_login' ? (
        <>
          <p>
            Hermes is asking for a login for <strong>{request.site}</strong>.
          </p>
          <p className="vault-origin">{request.origin}</p>
          <p className="request-note">
            The password goes directly to this Bot’s encrypted Hermes vault and its native browser
            fill tool. The site and identifier are visible metadata. Saving fills the password on
            the current page so the Bot can continue.
          </p>
        </>
      ) : request.kind === 'vault_unlock' ? (
        <p className="request-note">
          Your master password goes to the {request.displayName} CLI. Hermes keeps an unlock token
          in memory for this session; the master password is not saved or sent to the model.
        </p>
      ) : (
        <p className="request-note">
          {request.hint || 'Enter the code sent by this site.'} It is passed directly to Hermes’
          native browser tool.
        </p>
      )}
      <form onSubmit={submit}>
        {request.kind === 'vault_login' && (
          <label>
            Email, username or phone
            <input name="identifier" required maxLength={320} autoComplete="off" disabled={busy} />
          </label>
        )}
        <label>
          {request.kind === 'vault_login'
            ? 'Password'
            : request.kind === 'vault_unlock'
              ? 'Master password'
              : 'Verification code'}
          <input
            name="value"
            type="password"
            required
            maxLength={request.kind === 'vault_code' ? 2048 : 16000}
            autoComplete={request.kind === 'vault_code' ? 'one-time-code' : 'off'}
            disabled={busy}
          />
        </label>
        <div className="request-actions">
          <button type="button" disabled={busy} onClick={skip}>
            {request.kind === 'vault_login' ? 'Don’t save' : 'Skip'}
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {request.kind === 'vault_login'
              ? 'Save & fill'
              : request.kind === 'vault_unlock'
                ? 'Unlock'
                : 'Use code'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="request-error">
          {error}
        </p>
      )}
    </section>
  );
}
