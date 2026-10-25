const { z } = require('zod');
const text = z.string().max(256);
const rect = z
  .object({
    x: z.number().finite().min(-20000).max(20000),
    y: z.number().finite().min(-20000).max(20000),
    width: z.number().finite().min(0).max(20000),
    height: z.number().finite().min(0).max(20000),
  })
  .strict();
const presentation = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(128),
    scopeId: z.string().max(256),
    revision: z.number().int().nonnegative().safe(),
    draftSequence: z.number().int().nonnegative().safe(),
    visible: z.boolean(),
    viewport: z
      .object({
        width: z.number().finite().positive().max(20000),
        height: z.number().finite().positive().max(20000),
      })
      .strict(),
    navigation: z
      .object({
        rect,
        title: text,
        subtitle: text.optional(),
        backLabel: text.optional(),
        backVisible: z.boolean(),
        detailsVisible: z.boolean(),
        detailsLabel: text.optional(),
        selectedSurface: z.enum(['chat', 'computer']).optional(),
        computerVisible: z.boolean().optional(),
        settingsVisible: z.boolean().optional(),
        avatarColor: z.enum(['white', 'violet', 'green', 'orange', 'blue', 'pink']).optional(),
        group: z.boolean().optional(),
      })
      .strict(),
    composer: z
      .object({
        rect,
        visible: z.boolean(),
        focusRequest: z.number().int().nonnegative().safe().optional(),
        draft: z.string().max(60000),
        placeholder: text,
        disabled: z.boolean(),
        submitDisabled: z.boolean(),
        submitLabel: text,
        stopVisible: z.boolean(),
        stopDisabled: z.boolean(),
        stopLabel: text.optional(),
        attachmentVisible: z.boolean().optional(),
        attachmentDisabled: z.boolean().optional(),
        attachmentLabel: text.optional(),
      })
      .strict(),
  })
  .strict();
const action = z
  .object({
    type: z.enum([
      'draft',
      'submit',
      'stop',
      'back',
      'details',
      'chat',
      'computer',
      'settings',
      'attachment',
    ]),
    sessionId: z.string().max(128),
    scopeId: z.string().max(256),
    sequence: z.number().int().nonnegative().safe(),
    draft: z.string().max(60000).optional(),
  })
  .strict();
module.exports = { presentation, action };
