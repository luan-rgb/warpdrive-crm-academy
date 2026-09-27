import { z } from "zod";

// Microsoft Graph mail shapes (https://learn.microsoft.com/graph/api/resources/message), validated
// once at the fetch boundary in outlookClient.ts. Only the fields the CRM reads are declared; Zod
// strips the rest.
const emailAddressSchema = z.object({
  emailAddress: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
  }),
});
export type GraphRecipient = z.infer<typeof emailAddressSchema>;

const attachmentStubSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  contentType: z.string().nullish(),
  size: z.number().nullish(),
  isInline: z.boolean().nullish(),
});

export const graphMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  subject: z.string().nullish(),
  from: emailAddressSchema.nullish(),
  toRecipients: z.array(emailAddressSchema).default([]),
  ccRecipients: z.array(emailAddressSchema).default([]),
  body: z.object({ contentType: z.string(), content: z.string() }).nullish(),
  bodyPreview: z.string().nullish(),
  sentDateTime: z.string().nullish(),
  receivedDateTime: z.string().nullish(),
  internetMessageId: z.string().nullish(),
  parentFolderId: z.string().nullish(),
  attachments: z.array(attachmentStubSchema).default([]),
});
export type GraphMessage = z.infer<typeof graphMessageSchema>;

export const graphMessageListSchema = z.object({
  value: z.array(
    z.object({ id: z.string(), conversationId: z.string(), parentFolderId: z.string().nullish() }),
  ),
  "@odata.nextLink": z.string().optional(),
});

export const graphFolderSchema = z.object({ id: z.string() });

export const graphAttachmentSchema = z.object({ contentBytes: z.string() });

export const graphDraftSchema = z.object({ id: z.string(), conversationId: z.string() });
