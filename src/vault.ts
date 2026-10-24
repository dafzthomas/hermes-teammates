import { z } from 'zod';

export const loginOriginSchema = z
  .string()
  .max(2000)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an HTTP or HTTPS site URL without embedded credentials.')
  .transform((value) => new URL(value).origin);
export const loginInputSchema = z.object({
  label: z.string().trim().min(1).max(100),
  origin: loginOriginSchema,
  identifier: z.string().trim().min(1).max(320),
  identifierType: z.enum(['email', 'username', 'phone']).default('email'),
  password: z.string().min(1).max(16000),
  otpSecret: z.string().max(2048).optional(),
});
export const vaultItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  origin: z.string().nullable(),
  created_at: z.string(),
  backend: z.string(),
  identifier: z.string().optional(),
  identifier_type: z.string().optional(),
  has_otp: z.boolean().default(false),
});
export const vaultSourceSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  enabled: z.boolean(),
  needs_unlock: z.boolean(),
  unlocked: z.boolean(),
  installed: z.boolean(),
});
export const vaultSnapshotSchema = z.object({
  items: z.array(vaultItemSchema),
  sources: z.array(vaultSourceSchema),
});
export type VaultSnapshot = z.infer<typeof vaultSnapshotSchema>;
export type VaultItem = z.infer<typeof vaultItemSchema>;
export type VaultSource = z.infer<typeof vaultSourceSchema>;
