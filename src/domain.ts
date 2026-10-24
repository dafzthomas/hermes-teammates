import { z } from 'zod';

export const providerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('claude'),
    model: z.string().trim().min(1).max(160),
    borrowLogin: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('compatible'),
    model: z.string().trim().min(1).max(160),
    baseUrl: z
      .url()
      .refine(
        (v) => ['http:', 'https:'].includes(new URL(v).protocol),
        'Use an HTTP or HTTPS endpoint',
      ),
  }),
]);
export type Provider = z.infer<typeof providerSchema>;
export const botInputSchema = z.object({
  name: z.string().trim().min(1).max(48),
  role: z.string().trim().min(1).max(8000),
  color: z.enum(['white', 'violet', 'green', 'orange', 'blue', 'pink']).default('white'),
  provider: providerSchema,
});
export const botSchema = botInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  pinned: z.boolean().default(false),
  computerEnabled: z.boolean().default(false),
});
export type Bot = z.infer<typeof botSchema>;
const coordinate = { x: z.number().int().min(0).max(1279), y: z.number().int().min(0).max(799) };
export const computerActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click'),
    ...coordinate,
    button: z.enum(['left', 'right']).default('left'),
  }),
  z.object({ type: z.literal('move'), ...coordinate }),
  z.object({ type: z.literal('type'), text: z.string().max(20000) }),
  z.object({
    type: z.literal('key'),
    key: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w+ -]+$/),
  }),
  z.object({
    type: z.literal('scroll'),
    ...coordinate,
    direction: z.enum(['up', 'down']),
    amount: z.number().int().min(1).max(30).default(3),
  }),
]);
export const computerStatusSchema = z.object({
  state: z.enum(['off', 'starting', 'running', 'sleeping', 'error']),
  control: z.enum(['bot', 'human']),
  error: z.string().nullable(),
  installed: z.boolean(),
  enabled: z.boolean(),
});
export type ComputerStatus = z.infer<typeof computerStatusSchema>;
export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(z.string()).min(2),
});
export type Group = z.infer<typeof groupSchema>;
export const messageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  timestamp: z.number(),
  sessionId: z.string(),
  toolName: z.string().nullable().default(null),
});
export type Message = z.infer<typeof messageSchema>;
export const sessionSchema = z.object({ id: z.string(), title: z.string(), count: z.number() });
export type Session = z.infer<typeof sessionSchema>;
export const routineSchema = z
  .object({
    id: z.string(),
    name: z.string().default('Routine'),
    prompt: z.string().default(''),
    schedule_display: z.string().default(''),
    next_run_at: z.string().nullable().default(null),
    state: z.string().default('scheduled'),
    enabled: z.boolean().default(true),
    last_error: z.string().nullable().default(null),
  })
  .passthrough();
export type Routine = z.infer<typeof routineSchema>;
export const activitySchema = z.object({
  id: z.string(),
  botId: z.string(),
  kind: z.enum(['tool', 'run', 'error', 'exchange', 'routine']),
  text: z.string(),
  at: z.number(),
});
export type Activity = z.infer<typeof activitySchema>;
export const botDetailSchema = z.object({
  memory: z.string(),
  userMemory: z.string(),
  skills: z.array(z.object({ name: z.string(), content: z.string() })),
  files: z.array(z.object({ name: z.string(), size: z.number() })),
  secrets: z.array(z.string()),
  messages: z.array(messageSchema),
  sessions: z.array(sessionSchema),
  routines: z.array(routineSchema),
  routineOutputs: z.array(z.object({ name: z.string(), content: z.string() })),
  activity: z.array(activitySchema),
  routineError: z.string().nullable(),
});
export type BotDetail = z.infer<typeof botDetailSchema>;
const requestIdentity = { id: z.string(), botId: z.string(), title: z.string() };
export const questionSchema = z.object({
  qid: z.string(),
  question: z.string(),
  choices: z.array(z.string()).nullable().optional(),
  multi_select: z.boolean().optional(),
});
export const interactiveRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...requestIdentity, kind: z.literal('clarify'), questions: z.array(questionSchema) }),
  z.object({
    ...requestIdentity,
    kind: z.literal('approval'),
    command: z.string(),
    description: z.string(),
    choices: z.array(z.enum(['once', 'session', 'always', 'deny'])),
  }),
  z.object({
    ...requestIdentity,
    kind: z.literal('secret'),
    prompt: z.string(),
    envVar: z.string().optional(),
  }),
]);
export type InteractiveRequest = z.infer<typeof interactiveRequestSchema>;
export const requestResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clarify'), answers: z.record(z.string(), z.string().max(16000)) }),
  z.object({ kind: z.literal('approval'), choice: z.enum(['once', 'session', 'always', 'deny']) }),
  z.object({ kind: z.literal('secret'), value: z.string().max(16000) }),
]);
export type RequestResponse = z.infer<typeof requestResponseSchema>;
export const inboxSchema = z.object({
  conversations: z.array(
    z.object({
      botId: z.string(),
      title: z.string(),
      unread: z.number().int().nonnegative(),
      latestId: z.string(),
      preview: z.string(),
      at: z.number(),
    }),
  ),
  groups: z.array(
    z.object({
      groupId: z.string(),
      unread: z.number().int().nonnegative(),
      latestId: z.string(),
      preview: z.string(),
      at: z.number(),
    }),
  ),
});
export type Inbox = z.infer<typeof inboxSchema>;
export const snapshotSchema = z.object({
  bots: z.array(botSchema),
  groups: z.array(groupSchema),
  inbox: inboxSchema.default({ conversations: [], groups: [] }),
  requests: z.array(interactiveRequestSchema).default([]),
  running: z.array(
    z.object({ botId: z.string(), text: z.string(), activity: z.string(), title: z.string() }),
  ),
  runtime: z.object({
    available: z.boolean(),
    version: z.string(),
    error: z.string().nullable(),
    scheduler: z.boolean(),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
