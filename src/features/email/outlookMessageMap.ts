import { toAddressListHeader, toHeaderToken } from "./addressHeader";
import type { GmailMessage, GmailPart } from "./gmailSchemas";
import type { GraphMessage, GraphRecipient } from "./outlookSchemas";

// Ids of the well-known Outlook folders that change how the CRM treats a message. Graph reports
// a message's folder as an opaque parentFolderId, so the client resolves these once per session.
export interface OutlookFolderIds {
  trash: string;
  spam: string;
  sent: string;
}

// Outlook has folders, Gmail has labels. Sync and trash reconciliation (trashReconcile.ts) only
// understand Gmail labels, so each folder that matters maps to the label with the same meaning.
export function folderLabel(
  parentFolderId: string | null | undefined,
  f: OutlookFolderIds,
): string {
  if (parentFolderId === f.trash) return "TRASH";
  if (parentFolderId === f.spam) return "SPAM";
  if (parentFolderId === f.sent) return "SENT";
  return "INBOX";
}

function participant(r: GraphRecipient): { name?: string; email: string } {
  return { name: r.emailAddress.name, email: r.emailAddress.address ?? "" };
}

// Same bridge as the Gmail parser expects: headers + one body part + attachment stubs, so
// parseGmailMessage/extractAttachments read a Graph message unmodified.
export function toGmailMessageShape(msg: GraphMessage, folders: OutlookFolderIds): GmailMessage {
  const headers: NonNullable<GmailPart["headers"]> = [];
  if (msg.from !== null && msg.from !== undefined) {
    headers.push({ name: "From", value: toHeaderToken(participant(msg.from)) });
  }
  if (msg.toRecipients.length > 0) {
    headers.push({ name: "To", value: toAddressListHeader(msg.toRecipients.map(participant)) });
  }
  if (msg.ccRecipients.length > 0) {
    headers.push({ name: "Cc", value: toAddressListHeader(msg.ccRecipients.map(participant)) });
  }
  if (typeof msg.subject === "string") headers.push({ name: "Subject", value: msg.subject });
  const date = msg.sentDateTime ?? msg.receivedDateTime;
  if (typeof date === "string") {
    headers.push({ name: "Date", value: new Date(date).toUTCString() });
  }
  if (typeof msg.internetMessageId === "string") {
    headers.push({ name: "Message-ID", value: msg.internetMessageId });
  }

  const parts: GmailPart[] = [];
  if (msg.body !== null && msg.body !== undefined) {
    parts.push({
      mimeType: msg.body.contentType.toLowerCase() === "html" ? "text/html" : "text/plain",
      body: { data: Buffer.from(msg.body.content, "utf8").toString("base64url") },
    });
  }
  for (const a of msg.attachments) {
    if (a.isInline === true || typeof a.name !== "string" || a.name.length === 0) continue;
    parts.push({
      filename: a.name,
      mimeType: a.contentType ?? "application/octet-stream",
      body: { attachmentId: a.id, size: a.size ?? 0 },
    });
  }

  return {
    id: msg.id,
    threadId: msg.conversationId,
    snippet: msg.bodyPreview ?? undefined,
    internalDate: typeof date === "string" ? String(Date.parse(date)) : undefined,
    labelIds: [folderLabel(msg.parentFolderId, folders)],
    payload: { headers, parts },
  };
}
