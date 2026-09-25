import { z } from "zod";

// Nylas v3 unified message shape (confirmed live via `nylas email list --json` against a real
// connected Gmail grant, cross-checked against developer.nylas.com/docs/v3/email/messages/).
// Notably simpler than Gmail's own raw payload: fields arrive already decoded, not as a MIME
// tree, which is why nylasMessageMap.ts exists (it re-synthesizes just enough of a Gmail-shaped
// payload for parseGmailMessage/extractAttachments to read, rather than teaching those two
// Gmail-specific parsers a second, unrelated input shape).
const nylasParticipantSchema = z.object({ email: z.string(), name: z.string().optional() });

const nylasAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string().optional(),
  content_type: z.string().optional(),
  size: z.number().optional(),
  is_inline: z.boolean().optional(),
});

export const nylasMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  subject: z.string().optional(),
  from: z.array(nylasParticipantSchema).default([]),
  to: z.array(nylasParticipantSchema).default([]),
  cc: z.array(nylasParticipantSchema).default([]),
  body: z.string().optional(),
  snippet: z.string().optional(),
  date: z.number().optional(), // unix seconds
  attachments: z.array(nylasAttachmentSchema).default([]),
});
export type NylasMessage = z.infer<typeof nylasMessageSchema>;

export const nylasMessageListSchema = z.object({
  request_id: z.string().optional(),
  data: z.array(nylasMessageSchema).default([]),
  next_cursor: z.string().optional(),
});
export type NylasMessageList = z.infer<typeof nylasMessageListSchema>;

export const nylasThreadSchema = z.object({
  id: z.string(),
  message_ids: z.array(z.string()).default([]),
});
export type NylasThread = z.infer<typeof nylasThreadSchema>;

export const nylasSendResultSchema = z.object({ id: z.string(), thread_id: z.string() });
export type NylasSendResult = z.infer<typeof nylasSendResultSchema>;

export const nylasGrantSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  provider: z.string().optional(),
});
export type NylasGrant = z.infer<typeof nylasGrantSchema>;

// POST /v3/connect/token response.
export const nylasTokenResponseSchema = z.object({
  grant_id: z.string(),
  email: z.string().optional(),
  provider: z.string().optional(),
});
export type NylasTokenResponse = z.infer<typeof nylasTokenResponseSchema>;
