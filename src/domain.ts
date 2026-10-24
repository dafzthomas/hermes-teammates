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
});
export type Bot = z.infer<typeof botSchema>;
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
export const snapshotSchema = z.object({
  bots: z.array(botSchema),
  groups: z.array(groupSchema),
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
