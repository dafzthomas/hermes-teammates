import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  ArrowUp,
  Bot as BotIcon,
  CircleHelp,
  Clock3,
  MessageCircle,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { z } from 'zod';
import { RequestCard } from '../../src/RequestCard';
import { Transcript } from '../../src/Transcript';
import { useNativeControls } from '../../src/nativeControls';
import {
  botDetailSchema,
  snapshotSchema,
  type Bot,
  type BotDetail,
  type Routine,
  type RoutinePreference,
  type Snapshot,
} from '../../src/domain';
import {
  AccessRevoked,
  mobileApi,
  pair,
  restoreConnection,
  saveConnection,
  requestHost,
  type Connection,
} from './connection';
const groupSchema = z.array(
  z.object({ id: z.string(), name: z.string(), text: z.string(), at: z.number() }),
);
type Target = { kind: 'bot' | 'group'; id: string };
const mainChatTitle = 'Bot Chat';
const colors = ['white', 'violet', 'green', 'orange', 'blue', 'pink'] as const;
const editorLabels = {
  new: 'New Bot',
  settings: 'Bot settings',
  routine: 'New routine',
  group: 'New group',
  memory: 'Edit memory',
  credential: 'Add credential',
};
function Face({ bot }: { bot: Pick<Bot, 'name' | 'color'> }) {
  return (
    <span className={`face ${bot.color}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <path
          d="M24 3C36 3 44 14 43 27C42 39 33 46 21 44C9 43 3 34 5 22C6 10 13 3 24 3Z"
          fill="currentColor"
        />
        <rect x="16" y="18" width="4.5" height="11" rx="2.25" fill="#151515" />
        <rect x="28" y="18" width="4.5" height="11" rx="2.25" fill="#151515" />
      </svg>
    </span>
  );
}
function Icon({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="icon" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
function Badge({ count }: { count: number }) {
  return count > 0 ? (
    <span className="badge" aria-label={`${count} unread replies`}>
      {count > 99 ? '99+' : count}
    </span>
  ) : null;
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'Could not reach the host. Check your connection.';
}

function RoutinePreferenceForm({
  routine,
  question = false,
  output,
  customize,
  save,
}: {
  routine: Routine;
  question?: boolean;
  output?: string | null;
  customize: () => void;
  save: (preference: RoutinePreference) => Promise<void>;
}) {
  const [choice, setChoice] = useState<RoutinePreference | ''>(routine.updatePreference || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => setChoice(routine.updatePreference || ''), [routine.updatePreference]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!choice || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await save(choice);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save update preference');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  if (!routine.updatePreferenceAvailable) return null;
  return (
    <form
      className={question ? 'routine-update-card request-card' : 'routine-preference'}
      aria-label={`${routine.name} updates`}
      onSubmit={submit}
    >
      {question && (
        <>
          <strong>{routine.name}</strong>
          {output && <Markdown>{output}</Markdown>}
        </>
      )}
      <fieldset disabled={saving}>
        <legend>
          {question ? `How should I keep you updated on ${routine.name}?` : 'Result updates'}
        </legend>
        <div className="routine-update-options">
          {(
            [
              ['all', 'Keep all updates'],
              ['errors', 'Only when something goes wrong'],
              ['never', 'Never'],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="preference"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="form-note hint">
        This routine keeps running with any choice. Never keeps it quiet. You can still find its
        results in details.
      </p>
      <button type="button" disabled={saving} onClick={customize}>
        Choose which updates matter…
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={saving || !choice || (!question && choice === routine.updatePreference)}>
        {saving ? 'Saving…' : 'Save preference'}
      </button>
    </form>
  );
}

export function MobileApp() {
  const [connection, setConnection] = useState<Connection>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void restoreConnection()
      .then(setConnection)
      .catch(() => setError('Could not read secure storage. Unlock the device and reopen the app.'))
      .finally(() => setReady(true));
  }, []);
  if (!ready) return <div className="loading">Opening your workspace…</div>;
  if (!connection)
    return (
      <PairScreen
        error={error}
        connected={(c) => {
          setError('');
          setConnection(c);
        }}
      />
    );
  return (
    <Workspace
      key={connection.deviceId}
      connection={connection}
      disconnected={(message) => {
        setConnection(undefined);
        setError(message);
      }}
    />
  );
}
function PairScreen({
  error: initialError,
  connected,
}: {
  error: string;
  connected: (c: Connection) => void;
}) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    try {
      const c = await pair(
        String(data.get('url')),
        String(data.get('code')),
        String(data.get('name')),
      );
      form.reset();
      connected(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="pair-screen">
      <div className="pair-brand">
        <Face bot={{ name: 'Teammates', color: 'white' }} />
        <span>Teammates</span>
      </div>
      <div className="pair-intro">
        <h1>
          Your Bots.
          <br />
          Wherever you are.
        </h1>
        <p>Connect to the workspace running on your own host.</p>
      </div>
      <form onSubmit={submit}>
        <label>
          Host address
          <input
            name="url"
            type="url"
            required
            placeholder="https://hermes.example.com:4311"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label>
          Device name
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={
              Capacitor.getPlatform() === 'ios'
                ? 'My iPhone'
                : Capacitor.getPlatform() === 'android'
                  ? 'My Android'
                  : 'Browser check'
            }
          />
        </label>
        <label>
          Pairing code
          <input
            name="code"
            required
            maxLength={100}
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="hint">
          On your host, open Mobile devices and create a one-use code. Codes expire after five
          minutes.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect workspace'}
        </button>
      </form>
      <p className="pair-foot">
        <ShieldCheck size={16} /> Encrypted connection. Device access is revocable on your host.
      </p>
    </main>
  );
}
function Workspace({
  connection,
  disconnected,
}: {
  connection: Connection;
  disconnected: (message: string) => void;
}) {
  const [state, setState] = useState<Snapshot>();
  const [target, setTarget] = useState<Target>();
  const [tab, setTab] = useState<'bots' | 'activity' | 'host'>('bots');
  const [detail, setDetail] = useState<BotDetail>();
  const [groupMessages, setGroupMessages] = useState<z.infer<typeof groupSchema>>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(true);
  const [stopping, setStopping] = useState<string[]>([]);
  const [editor, setEditor] = useState<keyof typeof editorLabels>();
  const [info, setInfo] = useState(false);
  const transcriptRef = useRef<HTMLElement>(null);
  const followReplies = useRef(true);
  const backAction = useRef(() => {});
  const generation = useRef(0);
  const mounted = useRef(true);
  const foreground = useRef(true);
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const bot = state?.bots.find((b) => b.id === target?.id);
  const group = state?.groups.find((g) => g.id === target?.id);
  const running =
    state?.running.filter((r) =>
      target?.kind === 'group' ? group?.members.includes(r.botId) : r.botId === target?.id,
    ) || [];
  const conversationTitle = target?.kind === 'group' ? `Group ${target.id}` : mainChatTitle;
  const thisRun =
    target?.kind === 'bot' ? running.find((r) => r.title === mainChatTitle) : undefined;
  async function api(route: string, body?: unknown, method?: string) {
    return mobileApi(connection, route, body, method);
  }
  async function fail(e: unknown) {
    if (!mounted.current) return;
    if (e instanceof AccessRevoked) {
      await saveConnection().catch(() => {});
      disconnected(e.message);
    } else setError(errorText(e));
  }
  async function refresh() {
    if (!mounted.current || !foreground.current) return;
    const version = ++generation.current;
    const selected = latestTarget.current;
    const current = () => mounted.current && foreground.current && version === generation.current;
    try {
      const snapshot = snapshotSchema.parse(await api('/state?projection=canonical'));
      if (!current()) return;
      setState(snapshot);
      if (selected?.kind === 'bot') {
        const next = botDetailSchema.parse(await api(`/bots/${selected.id}?projection=canonical`));
        if (!current()) return;
        setDetail(next);
      } else if (selected?.kind === 'group') {
        const next = groupSchema.parse(await api(`/groups/${selected.id}`));
        if (!current()) return;
        setGroupMessages(next);
      }
      setError('');
    } catch (e) {
      if (current()) throw e;
    }
  }
  backAction.current = () => {
    if (editor) setEditor(undefined);
    else if (info) setInfo(false);
    else if (latestTarget.current) select(undefined);
    else void NativeApp.minimizeApp();
  };
  useEffect(() => {
    mounted.current = true;
    function setForeground(value: boolean) {
      if (foreground.current !== value) generation.current++;
      foreground.current = value;
      setActive(value);
    }
    function visibility() {
      setForeground(document.visibilityState === 'visible');
    }
    document.addEventListener('visibilitychange', visibility);
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => {
          setForeground(isActive);
        })
      : undefined;
    const back =
      Capacitor.getPlatform() === 'android'
        ? NativeApp.addListener('backButton', () => {
            backAction.current();
          })
        : undefined;
    return () => {
      mounted.current = false;
      generation.current++;
      document.removeEventListener('visibilitychange', visibility);
      void listener?.then((h) => h.remove());
      void back?.then((h) => h.remove());
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh();
      } catch (e) {
        if (!stopped) void fail(e);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [target?.id, target?.kind, active]);
  // Acknowledge exactly the loaded conversation, only while its transcript is visible.
  useEffect(() => {
    if (!active || info || editor || !target) return;
    const id =
      target.kind === 'bot'
        ? detail?.messages.filter((m) => m.role === 'assistant' && m.content).at(-1)?.id
        : groupMessages.at(-1)?.id;
    if (!id) return;
    void api(`/${target.kind === 'bot' ? 'bots' : 'groups'}/${target.id}/read`, {
      messageId: id,
      ...(target.kind === 'bot' ? { title: mainChatTitle, projection: 'canonical' } : {}),
    }).catch(fail);
  }, [
    active,
    info,
    editor,
    target?.id,
    target?.kind,
    detail?.messages.at(-1)?.id,
    groupMessages.at(-1)?.id,
  ]);
  function select(next?: Target) {
    followReplies.current = true;
    generation.current++;
    latestTarget.current = next;
    setTarget(next);
    setDetail(undefined);
    setGroupMessages([]);
    setDraft('');
    setInfo(false);
    setEditor(undefined);
    setError('');
  }
  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      await fail(e);
      return;
    } finally {
      setBusy(false);
    }
    await refresh().catch(fail);
  }
  async function stopBot(botId: string) {
    if (stopping.includes(botId)) return;
    setStopping((ids) => [...ids, botId]);
    try {
      await api(`/bots/${botId}/stop`, {});
      void refresh().catch(fail);
    } catch (e) {
      await fail(e);
    } finally {
      setStopping((ids) => ids.filter((id) => id !== botId));
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!target || !draft.trim()) return;
    const text = draft;
    await act(async () => {
      await api(
        `/${target.kind === 'bot' ? 'bots' : 'groups'}/${target.id}/${thisRun ? 'steer' : 'messages'}`,
        { text, ...(target.kind === 'bot' ? { title: mainChatTitle } : {}) },
      );
      setDraft('');
    });
  }
  const requests =
    state?.requests.filter((r) =>
      target?.kind === 'group'
        ? group?.members.includes(r.botId) && r.title === `Group ${group.id}`
        : r.botId === target?.id && !state?.groups.some((g) => r.title === `Group ${g.id}`),
    ) || [];
  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && followReplies.current) transcript.scrollTop = transcript.scrollHeight;
  }, [detail?.messages, groupMessages, thisRun?.text, requests.length, info]);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const customizeRoutine = (name: string) => {
    setComposerFocusRequest((current) => current + 1);
    setDraft(
      (current) =>
        `${current ? `${current}\n\n` : ''}For my "${name}" routine, only update me when…`,
    );
    setInfo(false);
    requestAnimationFrame(() => {
      if (!nativeComposer.current?.hasAttribute('data-native-controls'))
        nativeComposer.current?.querySelector('textarea')?.focus();
    });
  };
  const nativeNavigation = useRef<HTMLElement>(null);
  const nativeComposer = useRef<HTMLFormElement>(null);
  useNativeControls({
    enabled: Boolean(active && state && target && !info && !editor),
    scopeId: target ? `${target.kind}:${target.id}` : 'roster',
    navigationRef: nativeNavigation,
    composerRef: nativeComposer,
    navigation: {
      title: bot?.name || group?.name || 'Teammates',
      avatarColor: bot?.color,
      group: Boolean(group),
      subtitle: target?.kind === 'group' ? `${group?.members.length || 0} Bots` : 'Chat',
      backVisible: true,
      backLabel: 'Back to Bots',
      detailsVisible: Boolean(bot),
      detailsLabel: 'Bot details',
      settingsVisible: Boolean(bot),
    },
    composer: {
      draft,
      focusRequest: composerFocusRequest,
      placeholder: thisRun ? 'Steer the current task…' : `Message ${bot?.name || group?.name}…`,
      disabled: false,
      submitDisabled: busy || !draft.trim() || (!thisRun && running.length > 0),
      submitLabel: thisRun ? 'Send steering' : 'Send message',
      stopVisible: running.length > 0,
      stopDisabled: running.length > 0 && running.every((r) => stopping.includes(r.botId)),
      stopLabel: 'Stop',
    },
    onDraftChange: setDraft,
    onBack: () => select(undefined),
    onDetails: () => setInfo(!info),
    onStop: () => {
      for (const r of running) void stopBot(r.botId);
    },
    onSettings: () => setEditor('settings'),
  });
  if (!active) return <main className="loading">Teammates</main>;
  return (
    <main className="mobile-app">
      <header className="topbar" ref={nativeNavigation}>
        {target ? (
          <>
            <Icon label="Back to Bots" onClick={() => select(undefined)}>
              <ArrowLeft size={21} />
            </Icon>
            <div className="identity-pill">
              {bot ? <Face bot={bot} /> : <Users size={24} />}
              <div className="top-title">
                <strong>{bot?.name || group?.name}</strong>
                <small>
                  {info
                    ? 'Bot details'
                    : target.kind === 'group'
                      ? `${group?.members.length || 0} Bots`
                      : 'Chat'}
                </small>
              </div>
            </div>
            {bot && (
              <Icon label="Bot details" onClick={() => setInfo(!info)}>
                <Settings2 size={21} />
              </Icon>
            )}
          </>
        ) : (
          <>
            <Face bot={{ name: 'Teammates', color: 'white' }} />
            <strong>Teammates</strong>
            <span className="spacer" />
            {tab === 'bots' && (
              <Icon label="New Bot" onClick={() => setEditor('new')}>
                <Plus size={22} />
              </Icon>
            )}
          </>
        )}
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => void act(refresh)}>Retry</button>
        </div>
      )}
      {!state ? (
        <section className="empty">
          <Radio size={32} />
          <h2>Connecting to your host</h2>
          <p>{connection.url}</p>
          <button
            onClick={() => {
              void saveConnection()
                .then(() => disconnected(''))
                .catch(fail);
            }}
          >
            Forget this connection
          </button>
        </section>
      ) : target ? (
        info && bot ? (
          <section className="scroll details">
            <div className="bot-identity">
              <Face bot={bot} />
              <h1>{bot.name}</h1>
              <p>{bot.role}</p>
            </div>
            <div className="settings-group">
              <button className="wide" onClick={() => setEditor('settings')}>
                <Settings2 size={18} /> Bot settings
              </button>
            </div>
            <h2>Memory</h2>
            <div className="settings-group">
              <p className="preserve">
                {detail ? detail.memory || 'No saved memory yet.' : 'Loading memory…'}
              </p>
              <button className="wide" disabled={!detail} onClick={() => setEditor('memory')}>
                Edit memory
              </button>
            </div>
            <h2>Routines</h2>
            <div className="settings-group">
              {detail?.routineError && <p className="error">{detail.routineError}</p>}
              {detail?.routines.map((r) => (
                <div className="routine" key={r.id}>
                  <strong>{r.name}</strong>
                  <p>
                    {r.schedule_display} · {r.enabled ? r.state : 'Paused'}
                  </p>
                  {r.last_error && <p className="error">{r.last_error}</p>}
                  <RoutinePreferenceForm
                    key={`${bot.id}:${r.id}`}
                    routine={r}
                    customize={() => customizeRoutine(r.name)}
                    save={async (preference) => {
                      try {
                        await api(
                          `/bots/${bot.id}/routines/${encodeURIComponent(r.id)}/preference`,
                          { preference },
                          'PUT',
                        );
                        await refresh();
                      } catch (e) {
                        void fail(e);
                        throw e;
                      }
                    }}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api(
                          `/bots/${bot.id}/routines/${r.id}/${r.enabled ? 'pause' : 'resume'}`,
                          {},
                        ),
                      )
                    }
                  >
                    {r.enabled ? 'Pause' : 'Resume'}
                  </button>
                </div>
              ))}
              <button className="wide" onClick={() => setEditor('routine')}>
                <Plus size={18} /> Add routine
              </button>
              {detail?.routineOutputs.map((o) => (
                <details key={o.name}>
                  <summary>{o.name}</summary>
                  <pre>{o.content}</pre>
                </details>
              ))}
            </div>
            <p className="hint">
              Manage skills, files, connections, saved logins and Bot computers in the desktop app.
              Their runtime remains on your host. App action reviews and private requests can be
              answered here.
            </p>
            <details className="advanced settings-group">
              <summary>Advanced</summary>
              <h2>Model access</h2>
              <p>
                {bot.provider.kind === 'claude' ? 'Claude through Hermes' : 'OpenAI-compatible'} /{' '}
                {bot.provider.model}
              </p>
              <p className="hint">
                Hermes runs this Bot on your host. Model access and billing are managed there.
                Change the provider, model or endpoint in Bot settings.
              </p>
              <h2>Model credentials</h2>
              <p>{detail?.secrets.join(', ') || 'No credentials added.'}</p>
              <button className="wide" onClick={() => setEditor('credential')}>
                Add credential
              </button>
              <h2>On your host</h2>
              <p>
                {detail?.skills.length || 0} skills · {detail?.files.length || 0} files ·{' '}
                {detail?.connections.length || 0} app connections
              </p>
            </details>
          </section>
        ) : (
          <>
            <section
              className="scroll transcript"
              aria-label="Conversation"
              ref={transcriptRef}
              onScroll={(event) => {
                const view = event.currentTarget;
                followReplies.current =
                  view.scrollHeight - view.scrollTop - view.clientHeight < 100;
              }}
            >
              {!detail && target.kind === 'bot' && <p className="hint">Loading conversation…</p>}
              {detail && (
                <Transcript
                  messages={detail.messages}
                  botName={bot?.name || 'Bot'}
                  surface="mobile"
                />
              )}
              {groupMessages.map((m) => (
                <article className={`message ${m.name === 'You' ? 'from-user' : ''}`} key={m.id}>
                  <small>{m.name}</small>
                  <Markdown>{m.text}</Markdown>
                </article>
              ))}
              {detail?.messages.length === 0 && (
                <div className="empty">
                  <Face bot={bot!} />
                  <h2>What are we working on?</h2>
                  <p>{bot?.role}</p>
                </div>
              )}
              {running.map((r) => (
                <div className="working" key={r.botId}>
                  <Radio size={16} />
                  <span>
                    {state.bots.find((b) => b.id === r.botId)?.name}: {r.activity || 'Working…'}
                  </span>
                  <button
                    disabled={stopping.includes(r.botId)}
                    onClick={() => void stopBot(r.botId)}
                  >
                    <Square size={13} /> Stop
                  </button>
                  {r.title === conversationTitle && r.text && <p className="preserve">{r.text}</p>}
                </div>
              ))}
              {target.kind === 'bot' &&
                detail?.routines
                  .filter((r) => r.updatePrompt && r.updatePreferenceAvailable)
                  .map((r) => (
                    <RoutinePreferenceForm
                      key={`${target.id}:${r.updatePrompt!.id}`}
                      routine={r}
                      customize={() => customizeRoutine(r.name)}
                      question
                      output={
                        detail.routineOutputs.find((o) => o.name === r.updatePrompt!.outputName)
                          ?.response
                      }
                      save={async (preference) => {
                        try {
                          await api(
                            `/bots/${target.id}/routines/${encodeURIComponent(r.id)}/preference`,
                            { preference },
                            'PUT',
                          );
                          await refresh();
                        } catch (e) {
                          void fail(e);
                          throw e;
                        }
                      }}
                    />
                  ))}
              {requests.map((r) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  botName={state.bots.find((b) => b.id === r.botId)?.name || 'Bot'}
                  respond={async (response) => {
                    try {
                      await api(`/bots/${r.botId}/requests/${encodeURIComponent(r.id)}`, response);
                      await refresh();
                    } catch (e) {
                      void fail(e);
                      throw e;
                    }
                  }}
                />
              ))}
            </section>
            <form className="composer" ref={nativeComposer} onSubmit={send}>
              <textarea
                aria-label={thisRun ? 'Steer Bot' : 'Message'}
                placeholder={
                  thisRun ? 'Steer the current task…' : `Message ${bot?.name || group?.name}…`
                }
                rows={1}
                maxLength={target.kind === 'group' ? 30000 : 60000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                className="send"
                aria-label={thisRun ? 'Send steering' : 'Send message'}
                disabled={busy || !draft.trim() || (!thisRun && running.length > 0)}
              >
                <ArrowUp size={21} />
              </button>
            </form>
          </>
        )
      ) : tab === 'bots' ? (
        <section className="scroll roster">
          <div className="section-heading">
            <h1>Your Bots</h1>
            <span>{state.bots.length} teammates</span>
          </div>
          <input
            className="search"
            aria-label="Search Bots"
            placeholder="Find a teammate…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="host-status">
            <span className={`dot ${state.runtime.available ? 'online' : ''}`} />
            {state.runtime.available ? 'Workspace connected' : 'Workspace needs attention'}
            <small>
              {state.running.length ? `${state.running.length} working` : 'Ready when you are'}
            </small>
          </div>
          {!state.runtime.available && <p className="error">{state.runtime.error}</p>}
          {state.bots
            .filter((b) => `${b.name} ${b.role}`.toLowerCase().includes(query.toLowerCase()))
            .map((b) => {
              const unread = state.inbox.conversations
                .filter((i) => i.botId === b.id && i.title === mainChatTitle)
                .reduce((n, i) => n + i.unread, 0);
              const needed = state.requests.filter((r) => r.botId === b.id).length;
              const run = state.running.find((r) => r.botId === b.id);
              return (
                <button
                  className="bot-row"
                  key={b.id}
                  onClick={() => select({ kind: 'bot', id: b.id })}
                >
                  <Face bot={b} />
                  <span className="row-copy">
                    <strong>{b.name}</strong>
                    <span>
                      {needed ? 'Needs your response' : run ? run.activity || 'Working…' : b.role}
                    </span>
                  </span>
                  {needed ? (
                    <CircleHelp className="attention" size={20} />
                  ) : (
                    <Badge count={unread} />
                  )}
                </button>
              );
            })}
          <div className="section-heading">
            <h2>Groups</h2>
            <Icon label="New group" onClick={() => setEditor('group')}>
              <Plus size={19} />
            </Icon>
          </div>
          {state.groups.map((g) => (
            <button
              className="bot-row"
              key={g.id}
              onClick={() => select({ kind: 'group', id: g.id })}
            >
              <span className="group-face">
                <Users size={23} />
              </span>
              <span className="row-copy">
                <strong>{g.name}</strong>
                <span>
                  {g.members.map((id) => state.bots.find((b) => b.id === id)?.name).join(', ')}
                </span>
              </span>
              <Badge count={state.inbox.groups.find((i) => i.groupId === g.id)?.unread || 0} />
            </button>
          ))}
          {!state.groups.length && (
            <p className="hint">Bring two or more Bots into a shared conversation.</p>
          )}
        </section>
      ) : tab === 'activity' ? (
        <section className="scroll activity">
          <h1>Activity</h1>
          <p className="lede">Replies and decisions waiting for you.</p>
          {state.requests.map((r) => {
            const b = state.bots.find((b) => b.id === r.botId);
            const g = state.groups.find((g) => `Group ${g.id}` === r.title);
            return (
              <button
                className="activity-row"
                key={r.id}
                onClick={() =>
                  select(g ? { kind: 'group', id: g.id } : { kind: 'bot', id: r.botId })
                }
              >
                <CircleHelp className="attention" size={21} />
                <span>
                  <strong>{b?.name} needs you</strong>
                  <p>
                    {r.kind === 'action'
                      ? `Review ${r.toolName}`
                      : r.kind === 'clarify'
                        ? 'Answer a question'
                        : r.kind === 'approval'
                          ? 'Review an approval'
                          : 'Private input requested'}
                  </p>
                  {g && <small>{g.name}</small>}
                </span>
              </button>
            );
          })}
          {[...state.inbox.conversations.filter((i) => i.title === mainChatTitle)]
            .sort((a, b) => b.at - a.at)
            .map((i) => (
              <button
                className="activity-row"
                key={`${i.botId}-${i.title}`}
                onClick={() => select({ kind: 'bot', id: i.botId })}
              >
                <MessageCircle size={21} />
                <span>
                  <strong>{state.bots.find((b) => b.id === i.botId)?.name}</strong>
                  <p>{i.preview || 'New reply'}</p>
                  <small>{new Date(i.at).toLocaleString()}</small>
                </span>
                <Badge count={i.unread} />
              </button>
            ))}
          {!state.requests.length &&
            !state.inbox.conversations.some((i) => i.title === mainChatTitle) && (
              <div className="empty">
                <Clock3 size={32} />
                <h2>You're up to date</h2>
                <p>
                  Routine replies, Bot handoffs and questions will appear here while your host runs.
                </p>
              </div>
            )}
        </section>
      ) : (
        <section className="scroll details">
          <h1>Your host</h1>
          <p className="lede">Your Bots keep working here while your phone is away.</p>
          <div className="host-card">
            <ShieldCheck size={24} />
            <strong>{new URL(connection.url).host}</strong>
            <small>
              Device access expires {new Date(connection.expiresAt).toLocaleDateString()}
            </small>
          </div>
          <p>
            Keep the backend running and the host awake for routines and proactive work. This app
            refreshes while open. Push notifications are not included.
          </p>
          <p className="hint">
            This paired device can control your Bots and answer approvals. Bot profiles organize
            data; host tools still run with your OS user's access.
          </p>
          <div className="settings-group">
            <button
              className="wide danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await requestHost(
                    connection.url,
                    '/mobile/device',
                    undefined,
                    'DELETE',
                    connection.token,
                  );
                  await saveConnection();
                  disconnected('Device disconnected.');
                })
              }
            >
              Revoke access and disconnect
            </button>
            <button
              className="wide"
              onClick={() =>
                void saveConnection()
                  .then(() =>
                    disconnected(
                      'Connection forgotten on this device. Revoke its access on the host if it is no longer needed.',
                    ),
                  )
                  .catch(fail)
              }
            >
              Forget connection on this device
            </button>
          </div>
          <details className="advanced settings-group">
            <summary>Advanced</summary>
            <p className="hint">
              Hermes runs your Bots on the host. This device connects through its authenticated
              mobile gateway.
            </p>
          </details>
        </section>
      )}
      {!target && (
        <nav className="bottom-nav" aria-label="Main navigation">
          <button aria-current={tab === 'bots' ? 'page' : undefined} onClick={() => setTab('bots')}>
            <BotIcon size={22} />
            Bots
          </button>
          <button
            aria-current={tab === 'activity' ? 'page' : undefined}
            onClick={() => setTab('activity')}
          >
            <Radio size={22} />
            Activity
            {state?.requests.length ? (
              <span className="nav-count">{state.requests.length}</span>
            ) : null}
          </button>
          <button aria-current={tab === 'host' ? 'page' : undefined} onClick={() => setTab('host')}>
            <Settings2 size={22} />
            Host
          </button>
        </nav>
      )}
      {editor && (
        <div className="sheet-backdrop">
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={editorLabels[editor]}
          >
            <header>
              <h2>{editorLabels[editor]}</h2>
              <Icon label="Close form" onClick={() => setEditor(undefined)}>
                <X size={22} />
              </Icon>
            </header>
            <Editor
              key={`${editor}-${bot?.id}`}
              kind={editor}
              bot={bot}
              detail={detail}
              bots={state?.bots || []}
              busy={busy}
              save={async (body) => {
                await act(async () => {
                  if (editor === 'new' || editor === 'settings')
                    await api(
                      editor === 'new' ? '/bots' : `/bots/${bot!.id}`,
                      body,
                      editor === 'new' ? 'POST' : 'PUT',
                    );
                  else if (editor === 'group') await api('/groups', body);
                  else if (editor === 'memory') await api(`/bots/${bot!.id}/memory`, body, 'PUT');
                  else if (editor === 'credential') {
                    const credential = z
                      .object({ name: z.string(), value: z.string() })
                      .parse(body);
                    await api(
                      `/bots/${bot!.id}/secrets/${encodeURIComponent(credential.name)}`,
                      { value: credential.value },
                      'PUT',
                    );
                  } else await api(`/bots/${bot!.id}/routines`, body);
                  setEditor(undefined);
                });
              }}
            />
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
function Editor({
  kind,
  bot,
  detail,
  bots,
  busy,
  save,
}: {
  kind: string;
  bot?: Bot;
  detail?: BotDetail;
  bots: Bot[];
  busy: boolean;
  save: (body: unknown) => Promise<void>;
}) {
  const [provider, setProvider] = useState(bot?.provider.kind || 'claude');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (kind === 'memory' && !detail) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const get = (name: string) => String(data.get(name) || '');
    let body: unknown;
    if (kind === 'new' || kind === 'settings')
      body = {
        name: get('name'),
        role: get('role'),
        color: get('color'),
        provider:
          provider === 'claude'
            ? { kind: 'claude', model: get('model'), borrowLogin: data.has('borrowLogin') }
            : { kind: 'compatible', model: get('model'), baseUrl: get('baseUrl') },
      };
    else if (kind === 'group')
      body = { name: get('name'), members: data.getAll('members').map(String) };
    else if (kind === 'routine')
      body = { name: get('name'), prompt: get('prompt'), schedule: get('schedule') };
    else if (kind === 'memory') body = { kind: get('memoryKind'), content: get('content') };
    else {
      body = { name: get('name'), value: get('value') };
      form.reset();
    }
    void save(body);
  }
  return (
    <form
      onSubmit={submit}
      onInvalidCapture={(event) => {
        const field = event.target as HTMLElement;
        const advanced = field.closest('details');
        if (advanced) advanced.open = true;
      }}
    >
      {['new', 'settings', 'group', 'routine'].includes(kind) && (
        <label>
          Name
          <input
            name="name"
            required
            maxLength={kind === 'new' || kind === 'settings' ? 48 : 60}
            defaultValue={kind === 'settings' ? bot?.name : ''}
          />
        </label>
      )}
      {(kind === 'new' || kind === 'settings') && (
        <>
          <label>
            Job and instructions
            <textarea
              name="role"
              required
              maxLength={8000}
              rows={4}
              defaultValue={bot?.role}
              placeholder="What should this Bot help with?"
            />
          </label>
          <label>
            Bot color
            <select name="color" defaultValue={bot?.color || 'white'}>
              {colors.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            Model access must be set up before the first reply. Open Advanced to check the model
            setup on your host.
          </p>
          <details className="advanced settings-group">
            <summary>Advanced</summary>
            <label>
              Model access
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'claude' | 'compatible')}
              >
                <option value="claude">Claude through Hermes</option>
                <option value="compatible">OpenAI-compatible API / Ollama</option>
              </select>
            </label>
            <label>
              Model ID
              <input
                name="model"
                required
                maxLength={160}
                defaultValue={bot?.provider.model || 'claude-sonnet-4-6'}
              />
            </label>
            <label hidden={provider !== 'compatible'}>
              API base URL
              <input
                name="baseUrl"
                type="url"
                required={provider === 'compatible'}
                disabled={provider !== 'compatible'}
                defaultValue={
                  bot?.provider.kind === 'compatible'
                    ? bot.provider.baseUrl
                    : 'http://localhost:11434/v1'
                }
              />
              <small>This address is resolved on the Hermes host.</small>
            </label>
            <p className="hint">
              Add ANTHROPIC_API_KEY or OPENAI_API_KEY in Bot details when needed. Hermes owns model
              access and billing.
            </p>
          </details>
          <label className="check login-consent" hidden={provider !== 'claude'}>
            <input
              name="borrowLogin"
              type="checkbox"
              disabled={provider !== 'claude'}
              defaultChecked={bot?.provider.kind === 'claude' && bot.provider.borrowLogin}
            />
            Reuse the host's Claude Code login
          </label>
        </>
      )}
      {kind === 'group' && (
        <fieldset>
          <legend>Choose at least two Bots</legend>
          {bots.map((b) => (
            <label className="check" key={b.id}>
              <input type="checkbox" name="members" value={b.id} />
              {b.name}
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'routine' && (
        <>
          <label>
            Task
            <textarea name="prompt" required maxLength={10000} rows={4} />
          </label>
          <label>
            Schedule
            <input name="schedule" required maxLength={120} placeholder="every 2h" />
          </label>
          <p className="hint">
            Use a cron expression, every 2h, or an ISO timestamp. Your host must stay awake and
            running.
          </p>
        </>
      )}
      {kind === 'memory' && (
        <>
          <input type="hidden" name="memoryKind" value="MEMORY" />
          <label>
            Bot memory
            <textarea name="content" maxLength={60000} rows={12} defaultValue={detail?.memory} />
          </label>
        </>
      )}
      {kind === 'credential' && (
        <>
          <label>
            Credential name
            <input
              name="name"
              required
              pattern="[A-Z_][A-Z0-9_]*"
              autoCapitalize="characters"
              placeholder="ANTHROPIC_API_KEY"
            />
          </label>
          <label>
            Private value
            <input name="value" type="password" required autoComplete="off" maxLength={16000} />
          </label>
          <p className="hint">
            Saved in this Bot's native Hermes credential file on your host. Values are never
            returned to the app.
          </p>
        </>
      )}
      <button className="primary" disabled={busy || (kind === 'memory' && !detail)}>
        {busy
          ? 'Saving…'
          : kind === 'new'
            ? 'Create Bot'
            : kind === 'group'
              ? 'Create group'
              : kind === 'routine'
                ? 'Create routine'
                : 'Save changes'}
      </button>
    </form>
  );
}
