import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  Plug,
  ArrowDownToLine,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Clock3,
  FileText,
  Folder,
  KeyRound,
  Menu,
  MessageCircle,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Users,
  X,
  ExternalLink,
  Play,
  Pause,
  Trash2,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { z } from 'zod';
import { ComputerPanel } from './ComputerPanel';
import { RequestCard } from './RequestCard';
import { Transcript } from './Transcript';
import { useNativeControls } from './nativeControls';
import { ConnectionFields } from './ConnectionFields';
import { api } from './api';
import { VaultPanel } from './VaultPanel';
import { MobileDevices } from './MobileDevices';
import type { Editor } from './editor';
import {
  snapshotSchema,
  connectionInputSchema,
  type Connection,
  botDetailSchema,
  type Bot,
  type BotDetail,
  type Routine,
  type RoutinePreference,
  type Snapshot,
  type Group,
} from './domain';

function UnreadBadge({ count = 0 }: { count?: number }) {
  return count > 0 ? (
    <span className="unread-badge" aria-label={`${count} unread replies`}>
      {count > 99 ? '99+' : count}
    </span>
  ) : null;
}
function Face({ bot, large = false }: { bot: Pick<Bot, 'name' | 'color'>; large?: boolean }) {
  return (
    <span className={`face ${bot.color} ${large ? 'large' : ''}`} aria-hidden="true">
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
function IconButton({
  label,
  children,
  onClick,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
type Panel =
  'overview' | 'memory' | 'skills' | 'files' | 'secrets' | 'connections' | 'routines' | 'activity';
const groupMessagesSchema = z.array(
  z.object({ id: z.string(), name: z.string(), text: z.string(), at: z.number() }),
);
type GroupMessage = z.infer<typeof groupMessagesSchema>[number];
const emptyDetail: BotDetail = {
  memory: '',
  userMemory: '',
  skills: [],
  files: [],
  secrets: [],
  connections: [],
  messages: [],
  sessions: [],
  routines: [],
  routineOutputs: [],
  activity: [],
  routineError: null,
};
const colors = ['white', 'violet', 'green', 'orange', 'blue', 'pink'];
const RuntimeContext = createContext<Snapshot['runtime'] | undefined>(undefined);
function RuntimeDiagnostics() {
  const runtime = useContext(RuntimeContext);
  return (
    <>
      <h3>Runtime diagnostics</h3>
      <p>
        {runtime
          ? runtime.available
            ? 'Local runtime available'
            : 'Local runtime unavailable'
          : 'Checking local runtime…'}
      </p>
      <pre>{runtime?.version}</pre>
      {runtime?.error && <pre>{runtime.error}</pre>}
    </>
  );
}
function ProviderFields({ bot }: { bot?: Bot }) {
  const [kind, setKind] = useState<string>(bot?.provider.kind || 'claude');
  return (
    <>
      <label>
        Model access
        <select name="providerKind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="claude">Claude through Hermes</option>
          <option value="compatible">OpenAI-compatible API / Ollama</option>
        </select>
      </label>
      <label>
        Model
        <input
          name="model"
          required
          defaultValue={bot?.provider.model || 'claude-sonnet-4-6'}
          placeholder={kind === 'claude' ? 'claude-sonnet-4-6' : 'Your provider model ID'}
        />
      </label>
      {kind === 'compatible' ? (
        <label>
          API base URL
          <input
            name="baseUrl"
            type="url"
            required
            defaultValue={
              bot?.provider.kind === 'compatible'
                ? bot.provider.baseUrl
                : 'http://localhost:11434/v1'
            }
          />
          <small>
            Hermes sends inference requests to this endpoint. Add OPENAI_API_KEY in this Bot’s
            credentials if required.
          </small>
        </label>
      ) : (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              name="borrowLogin"
              defaultChecked={bot?.provider.kind === 'claude' && bot.provider.borrowLogin}
            />
            Use my existing Claude Code login
          </label>
          <p className="form-note">
            Otherwise, add ANTHROPIC_API_KEY to this Bot’s credentials. Reusing a login grants
            access to that shared model account. Hermes handles authentication and provider billing.
          </p>
        </>
      )}
    </>
  );
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

export function App() {
  const [state, setState] = useState<Snapshot>();
  const [surface, setSurface] = useState<'chat' | 'computer'>('chat');
  const [selected, setSelected] = useState('default');
  const [groupId, setGroupId] = useState<string>();
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([]);
  const [detail, setDetail] = useState<BotDetail>(emptyDetail);
  const title = 'Bot Chat';
  const [panel, setPanel] = useState<Panel>('overview');
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const focusTransfer = useRef(0);
  const [pending, setPending] = useState<{ target: string; text: string }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditorState] = useState<Editor>();
  const editorOpener = useRef<HTMLElement | null>(null);
  const setEditor = (value: Editor | undefined) => {
    if (value) editorOpener.current = document.activeElement as HTMLElement;
    setEditorState(value);
  };
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const sheet =
    sidebarOpen && viewportWidth <= 700
      ? 'sidebar'
      : panelOpen && viewportWidth < 1200
        ? 'details-panel'
        : undefined;
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const contextRef = useRef({ selected, title, groupId });
  contextRef.current = { selected, title, groupId };
  const generation = useRef(0);
  const loadedContext = useRef('');
  const readCursors = useRef(new Map<string, string>());
  const bot = state?.bots.find((b) => b.id === selected);
  const group = state?.groups.find((g) => g.id === groupId);
  const botRunning = state?.running.find((r) => r.botId === selected);
  const running = botRunning?.title === title ? botRunning : undefined;
  const groupWorking = group && state?.running.some((r) => group.members.includes(r.botId));
  const active = group ? groupWorking : botRunning;
  const requests =
    state?.requests.filter((request) =>
      group
        ? group.members.includes(request.botId) && request.title === `Group ${group.id}`
        : request.botId === selected &&
          !state?.groups.some((g) => request.title === `Group ${g.id}`),
    ) || [];
  const notify = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 3500);
  };

  const refreshState = useCallback(async () => {
    try {
      setState(snapshotSchema.parse(await api('/state?projection=canonical')));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot reach the app');
    }
  }, []);
  const refreshDetail = useCallback(async () => {
    const current = contextRef.current;
    const gen = ++generation.current;
    try {
      if (current.groupId) {
        const data = groupMessagesSchema.parse(await api(`/groups/${current.groupId}`));
        if (gen === generation.current) {
          loadedContext.current = `group:${current.groupId}`;
          setGroupMessages(data);
        }
      } else {
        const data = botDetailSchema.parse(
          await api(`/bots/${current.selected}?projection=canonical`),
        );
        if (gen === generation.current) {
          loadedContext.current = `bot:${current.selected}:${current.title}`;
          setDetail(data);
          setPending((p) =>
            data.messages.some((m) => m.role === 'user' && m.content === p?.text) ? undefined : p,
          );
        }
      }
    } catch (e) {
      if (gen === generation.current)
        setError(e instanceof Error ? e.message : 'Cannot read this Bot');
    } finally {
      if (gen === generation.current) setLoadingDetail(false);
    }
  }, []);
  useEffect(() => {
    void refreshState();
    const timer = setInterval(() => {
      void refreshState();
      void refreshDetail();
    }, 5000);
    const events = new EventSource('/api/events');
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    events.onmessage = () => {
      if (!refreshTimer)
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          void refreshState();
        }, 180);
    };
    return () => {
      clearInterval(timer);
      clearTimeout(refreshTimer);
      events.close();
    };
  }, [refreshState, refreshDetail]);
  useEffect(() => {
    setDetail(emptyDetail);
    setGroupMessages([]);
    setPending(undefined);
    setLoadingDetail(true);
    setError('');
    setDraft('');
    void refreshDetail();
  }, [selected, title, groupId, refreshDetail]);
  const latestVisible = groupId
    ? state?.inbox.groups.find((g) => g.groupId === groupId)?.latestId
    : state?.inbox.conversations.find((c) => c.botId === selected && c.title === title)?.latestId;
  useEffect(() => {
    if (latestVisible) void refreshDetail();
  }, [latestVisible, refreshDetail]);
  useEffect(() => {
    const acknowledge = () => {
      if (
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        loadingDetail ||
        (!groupId && surface !== 'chat')
      )
        return;
      const key = groupId ? `group:${groupId}` : `bot:${selected}:${title}`;
      if (loadedContext.current !== key) return;
      const messageId = groupId
        ? groupMessages.at(-1)?.id
        : detail.messages.findLast((m) => m.role === 'assistant' && m.content.trim())?.id;
      if (!messageId || readCursors.current.get(key) === messageId) return;
      readCursors.current.set(key, messageId);
      void api(
        groupId ? `/groups/${groupId}/read` : `/bots/${selected}/read`,
        groupId ? { messageId } : { title, messageId, projection: 'canonical' },
      )
        .then(refreshState)
        .catch(() => {
          if (readCursors.current.get(key) === messageId) readCursors.current.delete(key);
        });
    };
    acknowledge();
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => {
      window.removeEventListener('focus', acknowledge);
      document.removeEventListener('visibilitychange', acknowledge);
    };
  }, [
    state,
    selected,
    title,
    groupId,
    surface,
    loadingDetail,
    detail.messages,
    groupMessages,
    refreshState,
  ]);
  const runningCount = state?.running.length || 0;
  const prevRunning = useRef(0);
  useEffect(() => {
    if (prevRunning.current > runningCount) void refreshDetail();
    prevRunning.current = runningCount;
  }, [runningCount, refreshDetail]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    surface,
    detail.messages.length,
    groupMessages.length,
    running?.text.length,
    pending,
    requests.length,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasEditor = Boolean(editor);
  const savingRef = useRef(saving);
  savingRef.current = saving;
  useEffect(() => {
    if (!sheet) return;
    const opener = document.activeElement as HTMLElement;
    const transfer = focusTransfer.current;
    return () => {
      requestAnimationFrame(() => {
        if (transfer === focusTransfer.current && opener?.isConnected && !opener.closest('[inert]'))
          opener.focus();
      });
    };
  }, [sheet]);
  useEffect(() => {
    const targets: [string, boolean][] = [
      [
        '.sidebar',
        hasEditor || sheet === 'details-panel' || (viewportWidth <= 700 && !sidebarOpen),
      ],
      ['.chat-column', hasEditor || Boolean(sheet)],
      ['.details-panel', hasEditor || sheet === 'sidebar'],
      ['.sheet-backdrop', hasEditor],
    ];
    for (const [selector, inert] of targets) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.inert = inert;
    }
  }, [hasEditor, sheet, viewportWidth, sidebarOpen, panelOpen]);
  useEffect(() => {
    if (!hasEditor && !sheet) return;
    const container = document.querySelector<HTMLElement>(hasEditor ? '.modal' : `.${sheet}`);
    if (!container) return;
    const opener = hasEditor ? editorOpener.current : null;
    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        ),
      ).filter((element) => {
        if (!element.getClientRects().length) return false;
        const closed = element.closest('details:not([open])');
        return !closed || element === closed.querySelector('summary');
      });
    if (!container.contains(document.activeElement)) focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (hasEditor) {
          if (!savingRef.current) setEditorState(undefined);
        } else {
          setPanelOpen(false);
          setSidebarOpen(false);
        }
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (opener)
        requestAnimationFrame(() => {
          if (opener.isConnected && !opener.closest('[inert]')) opener.focus();
        });
    };
  }, [hasEditor, sheet]);

  const selectBot = (id: string) => {
    setSelected(id);
    setSurface('chat');
    setGroupId(undefined);
    setPanel('overview');
    setSidebarOpen(false);
    setPending(undefined);
  };
  const saveThenRefresh = async (work: Promise<unknown>, text: string) => {
    await work;
    await refreshState();
    await refreshDetail();
    notify(text);
  };
  function botEditor(existing?: Bot, advanced = false) {
    setEditor({
      title: existing ? 'Bot settings' : 'Create a Bot',
      body: (
        <>
          <label>
            Name
            <input
              name="name"
              required
              maxLength={48}
              defaultValue={existing?.name}
              autoFocus
              placeholder="e.g. Researcher"
            />
          </label>
          <label>
            What should this Bot do?
            <textarea
              name="role"
              rows={4}
              required
              defaultValue={existing?.role}
              placeholder="Give it a role, sources and standing boundaries."
            />
          </label>
          <label>
            Avatar color
            <select name="color" defaultValue={existing?.color || 'violet'}>
              {colors.map((color) => (
                <option key={color} value={color}>
                  {color[0].toUpperCase() + color.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            Model access must be set up before the first reply. Open Advanced to configure access;
            saved settings do not confirm a working connection.
          </p>
          <details className="advanced" open={advanced}>
            <summary>Advanced</summary>
            <ProviderFields bot={existing} />
          </details>
        </>
      ),
      submit: async (data) => {
        const kind = data.get('providerKind');
        const provider =
          kind === 'compatible'
            ? { kind, model: data.get('model'), baseUrl: data.get('baseUrl') }
            : {
                kind: 'claude',
                model: data.get('model'),
                borrowLogin: data.get('borrowLogin') === 'on',
              };
        const result = await api(
          existing ? `/bots/${existing.id}` : '/bots',
          { name: data.get('name'), role: data.get('role'), color: data.get('color'), provider },
          existing ? 'PUT' : 'POST',
        );
        await refreshState();
        const created = z.object({ id: z.string() }).parse(result);
        selectBot(created.id);
        notify(existing ? 'Bot updated' : 'Bot created');
      },
      button: existing ? 'Save changes' : 'Create Bot',
    });
  }
  function groupEditor() {
    setEditor({
      title: 'Create a group',
      body: (
        <>
          <label>
            Group name
            <input name="name" autoFocus required placeholder="e.g. Launch team" />
          </label>
          <fieldset>
            <legend>Choose at least two Bots</legend>
            {state?.bots.map((b) => (
              <label key={b.id} className="check-label">
                <input name="members" value={b.id} type="checkbox" />
                <Face bot={b} />
                {b.name}
              </label>
            ))}
          </fieldset>
          <p className="form-note">
            Members respond in order in a separate group conversation. Each keeps its own memory and
            credentials.
          </p>
        </>
      ),
      submit: async (data) => {
        const created = z
          .object({ id: z.string() })
          .parse(await api('/groups', { name: data.get('name'), members: data.getAll('members') }));
        await refreshState();
        setGroupId(created.id);
      },
      button: 'Create group',
    });
  }
  const memoryEditor = (kind: 'MEMORY' | 'USER') =>
    setEditor({
      title: kind === 'MEMORY' ? 'Edit Bot memory' : 'Edit what it knows about you',
      body: (
        <label>
          Saved memory
          <textarea
            autoFocus
            name="content"
            rows={12}
            defaultValue={kind === 'MEMORY' ? detail.memory : detail.userMemory}
            placeholder="Add lasting facts. Keep passwords and keys in Credentials."
          />
        </label>
      ),
      submit: (data) =>
        saveThenRefresh(
          api(`/bots/${selected}/memory`, { kind, content: data.get('content') }, 'PUT'),
          'Memory saved',
        ),
    });
  const skillEditor = (skill?: { name: string; content: string }) =>
    setEditor({
      title: skill ? 'Edit skill' : 'Add a skill',
      body: (
        <>
          <label>
            Skill name
            <input
              name="name"
              required
              pattern="[a-zA-Z0-9_-]+"
              defaultValue={skill?.name}
              placeholder="weekly-review"
              readOnly={Boolean(skill)}
            />
          </label>
          <label>
            SKILL.md
            <textarea
              name="content"
              rows={12}
              required
              defaultValue={
                skill?.content ||
                '---\nname: weekly-review\ndescription: Review current progress and identify decisions.\n---\n\nRead the current sources. Summarize what changed, cite evidence, and list decisions for the user. Do not contact anyone.\n'
              }
            />
          </label>
        </>
      ),
      submit: (data) =>
        saveThenRefresh(
          api(
            `/bots/${selected}/skills/${encodeURIComponent(String(data.get('name')))}`,
            { content: data.get('content') },
            'PUT',
          ),
          'Skill saved',
        ),
    });
  const secretEditor = () =>
    setEditor({
      title: 'Add a credential',
      body: (
        <>
          <p className="form-note">
            Saved in this Bot’s plaintext Hermes credential files with owner-only permissions.
            Values are never returned to this interface. This is local file storage, not an
            encrypted vault.
          </p>
          <label>
            Name
            <input
              name="name"
              required
              pattern="[A-Z][A-Z0-9_]*"
              placeholder={bot?.provider.kind === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}
              autoComplete="off"
            />
          </label>
          <label>
            Value
            <input type="password" name="value" required autoComplete="new-password" />
          </label>
        </>
      ),
      submit: (data) =>
        saveThenRefresh(
          api(
            `/bots/${selected}/secrets/${encodeURIComponent(String(data.get('name')))}`,
            { value: data.get('value') },
            'PUT',
          ),
          'Credential saved',
        ),
    });
  const connectionEditor = (connection?: Connection) =>
    setEditor({
      title: connection ? 'Edit app connection' : 'Connect an app',
      body: <ConnectionFields connection={connection} credentials={detail.secrets} />,
      button: connection ? 'Save connection' : 'Connect app',
      submit: async (data) => {
        let server;
        try {
          server =
            data.get('transport') === 'http'
              ? {
                  transport: 'http',
                  url: data.get('url'),
                  ...(data.get('bearerCredential')
                    ? { bearerCredential: data.get('bearerCredential') }
                    : {}),
                }
              : {
                  transport: 'stdio',
                  command: data.get('command'),
                  args: JSON.parse(String(data.get('args') || '[]')),
                  env: JSON.parse(String(data.get('env') || '{}')),
                };
        } catch {
          throw new Error('Use a JSON array for arguments and an object for credential bindings.');
        }
        const input = connectionInputSchema.parse({
          name: data.get('name'),
          enabled: data.has('enabled'),
          review: data.has('review'),
          server,
        });
        await saveThenRefresh(
          api(
            `/bots/${selected}/connections${connection ? `/${connection.id}` : ''}`,
            input,
            connection ? 'PUT' : 'POST',
          ),
          'App connection saved',
        );
      },
    });
  const routineEditor = () =>
    setEditor({
      title: 'Create a routine',
      body: (
        <>
          <label>
            Name
            <input name="name" required autoFocus placeholder="Morning check-in" />
          </label>
          <label>
            Instructions
            <textarea
              name="prompt"
              rows={4}
              required
              placeholder="Review my saved priorities and tell me what needs attention. Do not send messages."
            />
          </label>
          <label>
            When to run
            <input name="schedule" required defaultValue="0 9 * * 1-5" />
            <small>
              Hermes schedule, e.g. 0 9 * * 1-5 for weekday mornings, or every 2h. Cron times use
              this Bot’s Hermes time zone, or the host default.
            </small>
          </label>
          <p className="form-note">
            A routine performs real work using this Bot’s tools and credentials. It runs while the
            backend is running and delivers results into Bot Chat. A local backend sleeps with this
            computer.
          </p>
        </>
      ),
      submit: (data) =>
        saveThenRefresh(
          api(`/bots/${selected}/routines`, {
            name: data.get('name'),
            prompt: data.get('prompt'),
            schedule: data.get('schedule'),
          }),
          'Routine created',
        ),
      button: 'Create routine',
    });
  const fileInput = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('Choose a text file smaller than 2 MB.');
      return;
    }
    try {
      if (!/\.(txt|md|csv|json|ya?ml|html|css|js|ts|py|xml|log)$/i.test(file.name))
        throw new Error('This version supports text and source files.');
      await saveThenRefresh(
        api(
          `/bots/${selected}/files/${encodeURIComponent(file.name)}`,
          { content: await file.text() },
          'PUT',
        ),
        `${file.name} added to ${bot?.name}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    }
    if (fileInput.current) fileInput.current.value = '';
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim()) return;
    const text = draft.trim();
    setError('');
    try {
      if (running && !group) {
        await api(`/bots/${selected}/steer`, { text, title });
        setDraft('');
        notify('Steering queued for the next tool result');
        return;
      }
      if (active) return;
      await api(group ? `/groups/${group.id}/messages` : `/bots/${selected}/messages`, {
        text,
        title,
      });
      setPending({ target: group?.id || selected, text });
      setDraft('');
      await refreshState();
      if (group) await refreshDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message failed');
    }
  }
  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError('');
    try {
      await editor.submit(data);
      setEditor(undefined);
    } catch (e) {
      form.querySelectorAll<HTMLDetailsElement>('details.advanced').forEach((section) => {
        section.open = true;
      });
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  async function download(name: string) {
    const response = await fetch(`/api/bots/${selected}/files/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('Could not download file');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  const showPanel = (value: Panel) => {
    setPanel(value);
    setSidebarOpen(false);
    setPanelOpen(true);
  };
  function workspaceEditor(advanced = false) {
    setEditor({
      title: 'Your workspace',
      body: (
        <>
          <p>Your Bots keep their own conversations, memory, files and tools.</p>
          <p className="form-note">
            Local tools use your OS account. Separate Bot profiles are not a security sandbox.
          </p>
          <details className="advanced" open={advanced}>
            <summary>Advanced</summary>
            <RuntimeDiagnostics />
            <h3>About this workspace</h3>
            <p>
              Teammates is an open source interface for Hermes agents. Hermes runs conversations,
              memory, skills and routines in separate profiles.
            </p>
            <a
              className="text-link"
              href="https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode"
              target="_blank"
              rel="noreferrer"
            >
              Hermes Bot Mode documentation <ExternalLink size={13} />
            </a>
          </details>
        </>
      ),
      submit: async () => {},
      button: 'Done',
    });
  }
  const customizeRoutine = (name: string) => {
    focusTransfer.current++;
    setComposerFocusRequest((current) => current + 1);
    setDraft(
      (current) =>
        `${current ? `${current}\n\n` : ''}For my "${name}" routine, only update me when…`,
    );
    setSurface('chat');
    setPanelOpen(false);
  };
  const nativeNavigation = useRef<HTMLElement>(null);
  const nativeComposer = useRef<HTMLFormElement>(null);
  const focusedComposerRequest = useRef(0);
  useEffect(() => {
    if (
      !composerFocusRequest ||
      focusedComposerRequest.current === composerFocusRequest ||
      sheet ||
      editor ||
      surface !== 'chat'
    )
      return;
    const frame = requestAnimationFrame(() => {
      focusedComposerRequest.current = composerFocusRequest;
      if (!nativeComposer.current?.hasAttribute('data-native-controls'))
        nativeComposer.current?.querySelector('textarea')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [composerFocusRequest, sheet, editor, surface]);
  const stopCurrent = () => {
    const ids = group ? group.members : [selected];
    for (const id of ids) void api(`/bots/${id}/stop`, {}).catch((e) => setError(e.message));
  };
  useNativeControls({
    enabled: Boolean(state && !editor && !sheet),
    scopeId: group ? `group:${group.id}` : `bot:${selected}`,
    navigationRef: nativeNavigation,
    composerRef: nativeComposer,
    navigation: {
      title: group?.name || bot?.name || 'Bot',
      avatarColor: bot?.color,
      group: Boolean(group),
      subtitle: group ? `${group.members.length} Bots` : botRunning?.activity || 'Chat',
      backVisible: viewportWidth <= 700,
      backLabel: 'Open sidebar',
      detailsVisible: true,
      detailsLabel: `${panelOpen ? 'Hide' : 'Show'} ${group ? 'group' : 'Bot'} details`,
      selectedSurface: surface,
      computerVisible: !group && Boolean(bot),
      settingsVisible: !group && Boolean(bot),
    },
    composer: {
      draft,
      focusRequest: composerFocusRequest,
      placeholder:
        running && !group
          ? `Steer ${bot?.name} while it works…`
          : `Message ${group?.name || bot?.name || 'Bot'}…`,
      disabled: false,
      submitDisabled:
        !draft.trim() || !state?.runtime.available || Boolean(active && (group || !running)),
      submitLabel: running && !group ? 'Steer Bot' : 'Send message',
      stopVisible: Boolean(active),
      stopDisabled: false,
      stopLabel: 'Stop Bot',
      attachmentVisible: true,
      attachmentLabel: 'Add a text file',
    },
    onDraftChange: setDraft,
    onBack: () => setSidebarOpen(true),
    onDetails: () => {
      setSidebarOpen(false);
      setPanelOpen(!panelOpen);
    },
    onStop: stopCurrent,
    onSurfaceChange: setSurface,
    onSettings: () => botEditor(bot),
    onAttachment: () => fileInput.current?.click(),
  });
  const visibleBots =
    state?.bots.filter((b) => `${b.name} ${b.role}`.toLowerCase().includes(query.toLowerCase())) ||
    [];
  const lastFinished =
    detail.activity.filter((a) => a.kind === 'run' && a.text === 'Finished').at(-1)?.at || 0;
  const latestError = detail.activity
    .filter((a) => a.kind === 'error' && a.at > lastFinished)
    .at(-1);

  return (
    <div className="app-shell">
      {sheet && (
        <button
          className="sheet-backdrop"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={() => {
            setPanelOpen(false);
            setSidebarOpen(false);
          }}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        role={sheet === 'sidebar' ? 'dialog' : undefined}
        aria-modal={sheet === 'sidebar' ? true : undefined}
        aria-label="Workspace navigation"
      >
        <div className="brand">
          <IconButton
            className="sidebar-close"
            label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </IconButton>
          <span>Teammates</span>
          <IconButton className="sidebar-new" label="New Bot" onClick={() => botEditor()}>
            <Plus size={17} />
          </IconButton>
        </div>
        <div className="roster-label">
          Your Bots <span>{state?.bots.length || 0}</span>
        </div>
        <nav className="bot-list" aria-label="Bots">
          {visibleBots.map((b) => {
            const turn = state?.running.find((r) => r.botId === b.id);
            const conversations =
              state?.inbox.conversations.filter((c) => c.botId === b.id && c.title === title) || [];
            const unread = conversations.reduce((sum, c) => sum + c.unread, 0);
            const latest = conversations.toSorted((a, b) => b.at - a.at)[0];
            return (
              <button
                className={`bot-row ${b.id === selected && !group ? 'selected' : ''}`}
                key={b.id}
                onClick={() => selectBot(b.id)}
              >
                <Face bot={b} />
                <span className="bot-row-copy">
                  <strong>
                    {b.name}
                    {b.pinned && <span className="primary-dot" title="Primary Bot" />}
                  </strong>
                  <span className={turn ? 'working-text' : ''}>
                    {turn ? turn.activity : latest?.preview || b.role.split('.')[0]}
                  </span>
                </span>
                <UnreadBadge count={unread} />
                {turn && <span className="status-pulse" />}
              </button>
            );
          })}
          {!visibleBots.length && <p className="empty-small">No Bots match your search.</p>}
        </nav>
        <div className="roster-label group-label">
          Groups
          <IconButton label="Create group" onClick={groupEditor}>
            <Plus size={15} />
          </IconButton>
        </div>
        {state?.groups.map((g) => (
          <button
            className={`group-row ${g.id === groupId ? 'selected' : ''}`}
            key={g.id}
            onClick={() => {
              setGroupId(g.id);
              setSidebarOpen(false);
            }}
          >
            <span className="group-icon">
              <Users size={18} />
            </span>
            <span className="group-row-copy">
              {g.name}
              <small>{g.members.length} Bots</small>
            </span>
            <UnreadBadge count={state.inbox.groups.find((i) => i.groupId === g.id)?.unread} />
          </button>
        ))}
        {!state?.groups.length && (
          <button className="create-group" onClick={groupEditor}>
            <Users size={16} />
            Bring your Bots together
          </button>
        )}
        <div className="sidebar-footer">
          <MobileDevices />
          {searchOpen && (
            <div className="search-field">
              <Search size={15} />
              <input
                aria-label="Search Bots"
                autoFocus
                placeholder="Search your Bots…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘K</kbd>
            </div>
          )}
          <div className="sidebar-actions">
            <button
              className="local-account"
              aria-label="Your workspace settings and information"
              title="Your workspace settings and information"
              onClick={() => workspaceEditor()}
            >
              <span className="account-avatar" aria-hidden="true">
                Y
              </span>
            </button>
            <button
              className="sidebar-search"
              aria-label="Search Bots"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search size={17} />
              Search
            </button>
          </div>
        </div>
      </aside>
      <main className="chat-column">
        <header className="chat-header" ref={nativeNavigation}>
          <IconButton
            className="mobile-menu"
            label="Open sidebar"
            onClick={() => {
              setPanelOpen(false);
              setSidebarOpen(!sidebarOpen);
            }}
          >
            <Menu size={20} />
          </IconButton>
          <button
            className="chat-identity"
            onClick={() => {
              setSidebarOpen(false);
              setPanelOpen(!panelOpen);
              setPanel('overview');
            }}
          >
            {group ? (
              <span className="group-icon">
                <Users size={22} />
              </span>
            ) : (
              bot && <Face bot={bot} />
            )}
            <span>
              <strong>{group?.name || bot?.name || 'Bot'}</strong>
              <small className={running ? 'bot-activity' : undefined}>
                {group
                  ? `${group.members.length} Bots in this conversation`
                  : running
                    ? running.activity
                    : 'Your persistent AI teammate'}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
          {!group && bot && (
            <div className="surface-tabs" aria-label="Bot surface">
              <button
                className={surface === 'chat' ? 'selected' : ''}
                onClick={() => setSurface('chat')}
              >
                <MessageCircle size={15} />
                Chat
              </button>
              <button
                className={surface === 'computer' ? 'selected' : ''}
                onClick={() => setSurface('computer')}
              >
                <Monitor size={15} />
                Computer
              </button>
            </div>
          )}
          <div className="chat-header-actions">
            {!group && (
              <>
                <IconButton label="Bot settings" onClick={() => botEditor(bot)}>
                  <Settings2 size={18} />
                </IconButton>
              </>
            )}
            <button
              className="details-toggle"
              aria-label={`${panelOpen ? 'Hide' : 'Show'} ${group ? 'group' : 'Bot'} details`}
              aria-expanded={panelOpen}
              aria-controls="bot-details"
              onClick={() => {
                setSidebarOpen(false);
                setPanelOpen(!panelOpen);
              }}
            >
              <span>Details</span>
              <MoreHorizontal size={21} aria-hidden="true" />
            </button>
          </div>
        </header>
        {state && !state.runtime.available && (
          <div className="runtime-banner">
            <CircleHelp size={16} />
            <span>The local runtime is unavailable. Your Bots cannot reply yet.</span>
            <button onClick={() => workspaceEditor(true)}>View diagnostics</button>
          </div>
        )}
        {surface === 'computer' && bot && !group ? (
          <ComputerPanel key={bot.id} bot={bot} />
        ) : (
          <>
            <div className="transcript" aria-live="polite" aria-label="Conversation">
              {loadingDetail ? (
                <div className="loading-state">Loading conversation…</div>
              ) : (group ? groupMessages.length === 0 : detail.messages.length === 0) &&
                !running &&
                !pending ? (
                <div className="welcome">
                  <div className="welcome-avatar">
                    {group ? <Users size={42} /> : bot && <Face bot={bot} large />}
                  </div>
                  <h1>{group ? 'Better together.' : `Meet ${bot?.name || 'your Bot'}.`}</h1>
                  <p>
                    {group
                      ? 'Give the group a goal. Each Bot will bring its own knowledge and respond in turn.'
                      : 'A teammate with a memory. Give it a job, teach it your way of working, and pick up where you left off.'}
                  </p>
                  <div className="welcome-prompts">
                    {(group
                      ? [
                          'Work together on a plan for this week.',
                          'Compare your approaches to this project.',
                        ]
                      : [
                          'Help me plan my week.',
                          'What can you help me with?',
                          'Help me define a specialist Bot.',
                        ]
                    ).map((prompt) => (
                      <button key={prompt} onClick={() => setDraft(prompt)}>
                        {prompt}
                        <ArrowUp size={14} />
                      </button>
                    ))}
                  </div>
                  {!group && bot && (
                    <div className="welcome-access">
                      <button onClick={() => botEditor(bot, true)}>Configure model access</button>
                      <button onClick={() => showPanel('secrets')}>Add credential</button>
                    </div>
                  )}
                  <span className="welcome-note">
                    <ShieldCheck size={13} />
                    Conversations are saved in this workspace. Your model provider receives prompts.
                  </span>
                </div>
              ) : null}
              {group ? (
                groupMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`message-row ${m.name === 'You' ? 'user' : 'assistant'}`}
                  >
                    <div className="message-meta">
                      {m.name}
                      <time>
                        {new Date(m.at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <div className="bubble">
                      <Markdown>{m.text}</Markdown>
                    </div>
                  </div>
                ))
              ) : (
                <Transcript
                  messages={detail.messages}
                  botName={bot?.name || 'Bot'}
                  surface="desktop"
                />
              )}
              {pending &&
                pending.target === (group?.id || selected) &&
                !(group
                  ? groupMessages.some((m) => m.text === pending.text)
                  : detail.messages.some((m) => m.content === pending.text)) && (
                  <div className="message-row user">
                    <div className="message-meta">You</div>
                    <div className="bubble">
                      <Markdown>{pending.text}</Markdown>
                    </div>
                  </div>
                )}
              {running && (
                <div className="message-row assistant">
                  <div className="message-meta">
                    {bot?.name}
                    <span className="working-text">{running.activity}…</span>
                  </div>
                  <div className="bubble streaming">
                    {running.text ? (
                      <Markdown>{running.text}</Markdown>
                    ) : (
                      <span className="thinking-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!group &&
                detail.routines
                  .filter((r) => r.updatePrompt && r.updatePreferenceAvailable)
                  .map((r) => (
                    <RoutinePreferenceForm
                      key={`${selected}:${r.updatePrompt!.id}`}
                      routine={r}
                      customize={() => customizeRoutine(r.name)}
                      question
                      output={
                        detail.routineOutputs.find((o) => o.name === r.updatePrompt!.outputName)
                          ?.response
                      }
                      save={async (preference) => {
                        await api(
                          `/bots/${selected}/routines/${encodeURIComponent(r.id)}/preference`,
                          { preference },
                          'PUT',
                        );
                        await refreshDetail();
                      }}
                    />
                  ))}
              {requests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  botName={state?.bots.find((b) => b.id === request.botId)?.name || 'Bot'}
                  respond={async (response) => {
                    await api(
                      `/bots/${request.botId}/requests/${encodeURIComponent(request.id)}`,
                      response,
                    );
                    await refreshState();
                  }}
                />
              ))}
              {latestError && !running && (
                <div className="run-error">
                  <CircleHelp size={17} />
                  <div>
                    <strong>Something needs attention</strong>
                    <p>{latestError.text}</p>
                    <button onClick={() => botEditor(bot, true)}>Configure model access</button>
                  </div>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <div className="composer-area">
              {error && !editor && (
                <div className="error-notice" role="alert">
                  <span>{error}</span>
                  <IconButton label="Dismiss error" onClick={() => setError('')}>
                    <X size={14} />
                  </IconButton>
                </div>
              )}
              {active && (
                <div className="activity-line">
                  <span className="status-pulse" />
                  {group
                    ? 'Your Bots are working'
                    : `${bot?.name} is ${botRunning?.activity.toLowerCase()}`}
                  <button onClick={() => showPanel('activity')}>View activity</button>
                </div>
              )}
              <form className="composer" ref={nativeComposer} onSubmit={send}>
                <textarea
                  aria-label="Message"
                  placeholder={
                    running && !group
                      ? `Steer ${bot?.name} while it works…`
                      : `Message ${group?.name || bot?.name || 'Bot'}…`
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={viewportWidth <= 700 ? 1 : 2}
                />
                <div className="composer-tools">
                  <div>
                    <IconButton label="Add a text file" onClick={() => fileInput.current?.click()}>
                      <Plus size={19} />
                    </IconButton>
                  </div>
                  <div className="send-actions">
                    {active && (
                      <button
                        type="button"
                        className="send-button stop"
                        aria-label="Stop Bot"
                        onClick={stopCurrent}
                      >
                        <Square size={13} fill="currentColor" />
                      </button>
                    )}
                    {(!active || !group) && (
                      <button
                        className="send-button"
                        aria-label={running ? 'Steer Bot' : 'Send message'}
                        disabled={
                          !draft.trim() || !state?.runtime.available || Boolean(active && !running)
                        }
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              <div className="composer-caption">
                <span>Your model provider receives prompts.</span>
                <span>
                  {running && !group
                    ? 'Steering arrives with the next tool result'
                    : '↵ to send · Shift ↵ for a new line'}
                </span>
              </div>
            </div>
          </>
        )}
      </main>
      {panelOpen && (
        <aside
          id="bot-details"
          className="details-panel"
          role={sheet === 'details-panel' ? 'dialog' : undefined}
          aria-modal={sheet === 'details-panel' ? true : undefined}
          aria-label={group ? 'Group details' : 'Bot details'}
        >
          <div className="details-header">
            <span>{group ? 'Group details' : 'Bot details'}</span>
            <IconButton label="Close details" onClick={() => setPanelOpen(false)}>
              <X size={18} />
            </IconButton>
          </div>
          {group ? (
            <GroupDetails group={group} bots={state?.bots || []} selectBot={selectBot} />
          ) : (
            bot && (
              <>
                <div className="profile-heading">
                  <Face bot={bot} large />
                  <h2>{bot.name}</h2>
                  <span>{bot.id === 'default' ? 'Your primary Bot' : 'Your specialist Bot'}</span>
                </div>
                <div className="panel-tabs">
                  <button
                    className={panel === 'overview' ? 'active' : ''}
                    onClick={() => setPanel('overview')}
                  >
                    Overview
                  </button>
                  <button
                    className={panel === 'activity' ? 'active' : ''}
                    onClick={() => setPanel('activity')}
                  >
                    Activity
                  </button>
                </div>
                <div className="panel-content">
                  {panel !== 'overview' && panel !== 'activity' && (
                    <button className="back-link" onClick={() => setPanel('overview')}>
                      <ChevronLeft size={14} />
                      Overview
                    </button>
                  )}
                  {panel === 'overview' && (
                    <>
                      <div className="section-heading">
                        <h3>About</h3>
                        <IconButton label="Edit Bot" onClick={() => botEditor(bot)}>
                          <Settings2 size={14} />
                        </IconButton>
                      </div>
                      <div className="about-card">{bot.role}</div>
                      <h3 className="section-title">Resources</h3>
                      <div className="setup-grid">
                        <button onClick={() => showPanel('secrets')}>
                          <KeyRound size={19} />
                          <strong>Credentials</strong>
                          <span>
                            {detail.secrets.length
                              ? `${detail.secrets.length} saved`
                              : 'Add access'}
                          </span>
                        </button>
                        <button onClick={() => showPanel('files')}>
                          <Folder size={19} />
                          <strong>Files</strong>
                          <span>
                            {detail.files.length ? `${detail.files.length} files` : 'Add knowledge'}
                          </span>
                        </button>
                        <button onClick={() => showPanel('skills')}>
                          <BookOpen size={19} />
                          <strong>Skills</strong>
                          <span>
                            {detail.skills.length
                              ? `${detail.skills.length} skills`
                              : 'Teach a workflow'}
                          </span>
                        </button>
                        <button onClick={() => showPanel('memory')}>
                          <MessageCircle size={19} />
                          <strong>Memory</strong>
                          <span>
                            {detail.memory || detail.userMemory
                              ? 'Saved context'
                              : 'Ready to learn'}
                          </span>
                        </button>
                      </div>
                      <button
                        className="connection-shortcut"
                        onClick={() => showPanel('connections')}
                      >
                        <Plug size={18} />
                        <span>
                          <strong>Apps</strong>
                          <small>
                            {detail.connections.length
                              ? `${detail.connections.length} connected`
                              : 'Connect tools to this Bot'}
                          </small>
                        </span>
                        <Plus size={14} />
                      </button>
                      <div className="section-heading">
                        <h3>Memories</h3>
                        <IconButton label="Edit memory" onClick={() => memoryEditor('MEMORY')}>
                          <Plus size={15} />
                        </IconButton>
                      </div>
                      <button className="memory-preview" onClick={() => showPanel('memory')}>
                        {detail.memory || detail.userMemory ? (
                          <span>{(detail.memory || detail.userMemory).slice(0, 180)}</span>
                        ) : (
                          <>
                            <MessageCircle size={17} />
                            <span>
                              No memories yet<small>Lasting context, remembered by this Bot.</small>
                            </span>
                          </>
                        )}
                      </button>
                      <div className="section-heading">
                        <h3>Routines</h3>
                        <IconButton label="Add routine" onClick={routineEditor}>
                          <Plus size={15} />
                        </IconButton>
                      </div>
                      {detail.routines.length ? (
                        <div className="routine-list">
                          {detail.routines.slice(0, 3).map((r) => (
                            <button
                              className="routine-preview"
                              key={r.id}
                              onClick={() => showPanel('routines')}
                            >
                              <Clock3 size={17} />
                              <span>
                                {r.name}
                                <small>{r.schedule_display || r.next_run_at || r.state}</small>
                              </span>
                              <span
                                className={`mini-toggle ${r.enabled && r.state !== 'paused' ? 'on' : ''}`}
                              />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button className="routine-empty" onClick={routineEditor}>
                          <Clock3 size={18} />
                          <strong>A little more proactive.</strong>
                          <span>
                            Let {bot.name} check in, prepare a brief, or pick up recurring work.
                          </span>
                          <span className="routine-add">
                            <Plus size={13} />
                            Create a routine
                          </span>
                        </button>
                      )}
                      <details className="advanced">
                        <summary>Advanced</summary>
                        <button className="text-link" onClick={() => botEditor(bot, true)}>
                          Configure model access
                        </button>
                        <p className="form-note">
                          Configured model: {bot.provider.model}. Access is not checked here.
                        </p>
                        <button className="text-link" onClick={() => workspaceEditor(true)}>
                          View runtime diagnostics
                        </button>
                      </details>
                      <div className="profile-footer">
                        <ShieldCheck size={14} />
                        <span>Memory and resources belong to this Bot.</span>
                      </div>
                    </>
                  )}
                  {panel === 'memory' && (
                    <>
                      <h3>Memory</h3>
                      <p className="panel-description">
                        Saved context for this Bot’s future conversations.
                      </p>
                      {(['MEMORY', 'USER'] as const).map((kind) => (
                        <div className="resource-card" key={kind}>
                          <div className="section-heading">
                            <strong>{kind === 'MEMORY' ? 'Bot memory' : 'About you'}</strong>
                            <button onClick={() => memoryEditor(kind)}>Edit</button>
                          </div>
                          <div className="memory-content">
                            <Markdown>
                              {(kind === 'MEMORY' ? detail.memory : detail.userMemory) ||
                                'Nothing saved yet.'}
                            </Markdown>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  {panel === 'files' && (
                    <>
                      <div className="section-heading">
                        <h3>Files</h3>
                        <button onClick={() => fileInput.current?.click()}>
                          <Plus size={14} />
                          Add file
                        </button>
                      </div>
                      <p className="panel-description">
                        Text documents and source files in this Bot’s workspace. The Bot can read
                        and update them.
                      </p>
                      {detail.files.map((f) => (
                        <div className="file-row" key={f.name}>
                          <FileText size={18} />
                          <span>
                            {f.name}
                            <small>{new Intl.NumberFormat().format(f.size)} bytes</small>
                          </span>
                          <IconButton
                            label={`Download ${f.name}`}
                            onClick={() => {
                              void download(f.name).catch((e) => setError(e.message));
                            }}
                          >
                            <ArrowDownToLine size={16} />
                          </IconButton>
                        </div>
                      ))}
                      {!detail.files.length && (
                        <div className="empty-resource">
                          <Folder size={28} />
                          <p>Add a document for this Bot to work with.</p>
                        </div>
                      )}
                    </>
                  )}
                  {panel === 'skills' && (
                    <>
                      <div className="section-heading">
                        <h3>Skills</h3>
                        <button onClick={() => skillEditor()}>
                          <Plus size={14} />
                          Add skill
                        </button>
                      </div>
                      <p className="panel-description">
                        Reusable instructions saved in this Bot’s skills folder. The Bot can learn
                        new skills as it works.
                      </p>
                      {detail.skills.map((s) => (
                        <button className="skill-row" key={s.name} onClick={() => skillEditor(s)}>
                          <BookOpen size={18} />
                          <span>
                            {s.name}
                            <small>Open instructions</small>
                          </span>
                          <ChevronDown size={14} />
                        </button>
                      ))}
                      {!detail.skills.length && (
                        <div className="empty-resource">
                          <BookOpen size={28} />
                          <p>Save a workflow, or teach your Bot in chat.</p>
                        </div>
                      )}
                    </>
                  )}
                  {panel === 'secrets' && (
                    <>
                      <div className="section-heading">
                        <h3>Credentials</h3>
                        <button onClick={secretEditor}>
                          <Plus size={14} />
                          Add
                        </button>
                      </div>
                      <p className="panel-description">
                        Keys belong to this Bot’s Hermes profile. Values are kept out of this
                        interface and conversation prompts. Tools may use them.
                      </p>
                      {detail.secrets.map((s) => (
                        <div className="secret-row" key={s}>
                          <KeyRound size={17} />
                          <span>
                            {s}
                            <small>••••••••••••</small>
                          </span>
                          <IconButton
                            label={`Remove ${s}`}
                            onClick={() =>
                              setEditor({
                                title: 'Remove credential',
                                body: (
                                  <p>
                                    Remove {s} from {bot.name}? Tools using it will lose access.
                                  </p>
                                ),
                                submit: () =>
                                  saveThenRefresh(
                                    api(`/bots/${selected}/secrets/${s}`, undefined, 'DELETE'),
                                    'Credential removed',
                                  ),
                                button: 'Remove credential',
                              })
                            }
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      ))}
                      <div className="storage-note">
                        <ShieldCheck size={18} />
                        <p>
                          API keys use this Bot’s plaintext .env and Hermes authentication storage,
                          with owner-only permissions. Website logins below use the separate
                          encrypted Hermes vault.
                        </p>
                      </div>
                      <VaultPanel key={bot.id} botId={bot.id} botName={bot.name} edit={setEditor} />
                    </>
                  )}
                  {panel === 'connections' && (
                    <>
                      <div className="section-heading">
                        <h3>Apps</h3>
                        <button onClick={() => connectionEditor()}>
                          <Plus size={14} />
                          Connect app
                        </button>
                      </div>
                      <p className="panel-description">
                        Connect an MCP app to this Bot. Each connection has its own credential
                        bindings. Reviewed tool calls pause in Chat so you can edit or deny them.
                      </p>
                      {detail.connections.map((connection) => (
                        <div className="resource-card connection-card" key={connection.id}>
                          <div className="section-heading">
                            <strong>{connection.name}</strong>
                            <button onClick={() => connectionEditor(connection)}>Edit</button>
                          </div>
                          <small>
                            {connection.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                            {connection.review ? 'Review every action' : 'Runs without review'}
                          </small>
                          <p>
                            {connection.server.transport === 'http'
                              ? new URL(connection.server.url).host
                              : connection.server.command}
                          </p>
                          <button
                            className="remove-connection"
                            onClick={() =>
                              setEditor({
                                title: 'Disconnect app',
                                body: (
                                  <p>
                                    Disconnect {connection.name} from {bot.name}? Its saved
                                    credentials stay with this Bot.
                                  </p>
                                ),
                                button: 'Disconnect',
                                submit: () =>
                                  saveThenRefresh(
                                    api(
                                      `/bots/${selected}/connections/${connection.id}`,
                                      undefined,
                                      'DELETE',
                                    ),
                                    'App disconnected',
                                  ),
                              })
                            }
                          >
                            <Trash2 size={13} />
                            Disconnect
                          </button>
                        </div>
                      ))}
                      {!detail.connections.length && (
                        <div className="empty-resource">
                          <Plug size={28} />
                          <p>
                            No apps connected. Add an HTTP MCP endpoint or an installed MCP command.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {panel === 'routines' && (
                    <>
                      <div className="section-heading">
                        <h3>Routines</h3>
                        <button onClick={routineEditor}>
                          <Plus size={14} />
                          Create
                        </button>
                      </div>
                      <p className="panel-description">
                        Hermes cron jobs. The backend checks for due work every 30 seconds. It must
                        stay running for work to start.
                      </p>
                      {detail.routineError && (
                        <div className="inline-error">{detail.routineError}</div>
                      )}
                      {detail.routines.map((r) => (
                        <div className="resource-card" key={r.id}>
                          <strong>{r.name}</strong>
                          <p>{r.prompt}</p>
                          <small>
                            {r.schedule_display || 'Scheduled'}
                            <br />
                            {r.next_run_at
                              ? `Next: ${new Date(r.next_run_at).toLocaleString()}`
                              : r.state}
                          </small>
                          <RoutinePreferenceForm
                            key={`${selected}:${r.id}`}
                            routine={r}
                            customize={() => customizeRoutine(r.name)}
                            save={async (preference) => {
                              await api(
                                `/bots/${selected}/routines/${encodeURIComponent(r.id)}/preference`,
                                { preference },
                                'PUT',
                              );
                              await refreshDetail();
                            }}
                          />
                          <div className="routine-controls">
                            <button
                              onClick={() => {
                                void saveThenRefresh(
                                  api(
                                    `/bots/${selected}/routines/${r.id}/${r.state === 'paused' || !r.enabled ? 'resume' : 'pause'}`,
                                    {},
                                  ),
                                  'Routine updated',
                                ).catch((e) => setError(e.message));
                              }}
                            >
                              {r.state === 'paused' || !r.enabled ? (
                                <Play size={13} />
                              ) : (
                                <Pause size={13} />
                              )}{' '}
                              {r.state === 'paused' || !r.enabled ? 'Resume' : 'Pause'}
                            </button>
                            <button
                              onClick={() =>
                                setEditor({
                                  title: 'Delete routine',
                                  body: (
                                    <p>Delete {r.name}? Its next scheduled run will be removed.</p>
                                  ),
                                  submit: () =>
                                    saveThenRefresh(
                                      api(`/bots/${selected}/routines/${r.id}/remove`, {}),
                                      'Routine deleted',
                                    ),
                                  button: 'Delete routine',
                                })
                              }
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                      {!detail.routines.length && (
                        <div className="empty-resource">
                          <Clock3 size={28} />
                          <p>No routines yet. Create one for a recurring job.</p>
                        </div>
                      )}
                      {detail.routineOutputs.length > 0 && (
                        <>
                          <h3 className="section-title">Run results</h3>
                          {detail.routineOutputs.map((output) => (
                            <details className="output-card" key={output.name}>
                              <summary>{output.name}</summary>
                              <Markdown>{output.content}</Markdown>
                            </details>
                          ))}
                        </>
                      )}
                    </>
                  )}
                  {panel === 'activity' && (
                    <>
                      <h3>Activity</h3>
                      <p className="panel-description">
                        Tool calls, bot exchanges and run outcomes from this workspace.
                      </p>
                      <div className="timeline">
                        {detail.activity
                          .slice()
                          .reverse()
                          .map((a) => (
                            <div className={`timeline-row ${a.kind}`} key={a.id}>
                              <span className="timeline-dot" />
                              <div>
                                <time>
                                  {new Date(a.at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </time>
                                <strong>
                                  {a.kind === 'exchange'
                                    ? 'Bot exchange'
                                    : a.kind === 'run'
                                      ? 'Run'
                                      : a.kind === 'error'
                                        ? 'Needs attention'
                                        : 'Tool activity'}
                                </strong>
                                <pre>{a.text}</pre>
                              </div>
                            </div>
                          ))}
                      </div>
                      {!detail.activity.length && (
                        <div className="empty-resource">
                          <Activity size={28} />
                          <p>Activity will appear when your Bot starts working.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )
          )}
        </aside>
      )}
      <input
        ref={fileInput}
        type="file"
        className="visually-hidden"
        accept=".txt,.md,.csv,.json,.yaml,.yml,.html,.css,.js,.ts,.py,.xml,.log"
        onChange={(e) => {
          void upload(e.target.files?.[0]);
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {editor && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setEditor(undefined);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="modal-header">
              <h2 id="dialog-title">{editor.title}</h2>
              <IconButton
                label="Close dialog"
                onClick={() => {
                  if (!saving) setEditor(undefined);
                }}
              >
                <X size={19} />
              </IconButton>
            </div>
            <form
              onSubmit={submitEditor}
              onInvalidCapture={(event) => {
                const field = event.target as HTMLInputElement;
                const section = field.closest('details');
                if (section && !section.open) {
                  section.open = true;
                  requestAnimationFrame(() => field.focus());
                }
              }}
            >
              <div className="modal-body">
                <RuntimeContext.Provider value={state?.runtime}>
                  {editor.body}
                </RuntimeContext.Provider>
                {error && (
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setEditor(undefined)} disabled={saving}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editor.button || 'Save'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function GroupDetails({
  group,
  bots,
  selectBot,
}: {
  group: Group;
  bots: Bot[];
  selectBot: (id: string) => void;
}) {
  return (
    <div className="panel-content">
      <div className="profile-heading">
        <span className="group-icon large">
          <Users size={34} />
        </span>
        <h2>{group.name}</h2>
        <span>A shared conversation</span>
      </div>
      <h3 className="section-title">Members</h3>
      {group.members.map((id) => {
        const bot = bots.find((b) => b.id === id);
        return (
          bot && (
            <button className="group-member" key={id} onClick={() => selectBot(id)}>
              <Face bot={bot} />
              <span>
                {bot.name}
                <small>{bot.role.slice(0, 70)}</small>
              </span>
            </button>
          )
        );
      })}
      <div className="storage-note">
        <Users size={19} />
        <p>
          Members see messages in this group. Their private memories, files and credentials stay in
          their own profiles. Local tools still run under the same OS account.
        </p>
      </div>
    </div>
  );
}
