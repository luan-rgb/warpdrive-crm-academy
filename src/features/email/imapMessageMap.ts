import { type AddressObject, type ParsedMail, simpleParser } from "mailparser";
import { toAddressListHeader, toHeaderToken } from "./addressHeader";
import type { GmailMessage, GmailPart } from "./gmailSchemas";
import { threadRoot, threadToken } from "./imapIds";

type Participant = { name?: string; email: string };

function participants(a: AddressObject | AddressObject[] | undefined): Participant[] {
  if (a === undefined) return [];
  return (Array.isArray(a) ? a : [a])
    .flatMap((o) => o.value)
    .filter((v) => typeof v.address === "string" && v.address.length > 0)
    .map((v) => ({ name: v.name, email: v.address ?? "" }));
}

function referenceList(r: ParsedMail["references"]): string[] {
  if (r === undefined) return [];
  return Array.isArray(r) ? r : r.split(/\s+/).filter((s) => s.length > 0);
}

// Attachments an IMAP message exposes to the CRM: named, and not an inline part of the HTML body.
// Identified by their position in mailparser's list, which is deterministic for the same source,
// so getAttachment can re-parse the message and pick the same one.
export function isListedAttachment(a: ParsedMail["attachments"][number]): boolean {
  return typeof a.filename === "string" && a.filename.length > 0 && a.related !== true;
}

// Parse raw RFC 822 source (mailparser decodes charsets, encoded words and transfer encodings) and
// rebuild the Gmail-shaped payload parseGmailMessage/extractAttachments already read, exactly as
// the Outlook adapter does.
export async function toGmailMessageShape(
  source: Buffer,
  where: { id: string; label: string },
): Promise<GmailMessage> {
  const mail = await simpleParser(source, { skipImageLinks: true });
  const headers: NonNullable<GmailPart["headers"]> = [];
  const from = participants(mail.from)[0];
  if (from !== undefined) headers.push({ name: "From", value: toHeaderToken(from) });
  const to = participants(mail.to);
  if (to.length > 0) headers.push({ name: "To", value: toAddressListHeader(to) });
  const cc = participants(mail.cc);
  if (cc.length > 0) headers.push({ name: "Cc", value: toAddressListHeader(cc) });
  if (mail.subject !== undefined) headers.push({ name: "Subject", value: mail.subject });
  if (mail.date !== undefined) headers.push({ name: "Date", value: mail.date.toUTCString() });
  if (mail.messageId !== undefined) headers.push({ name: "Message-ID", value: mail.messageId });

  const parts: GmailPart[] = [];
  if (typeof mail.html === "string") {
    parts.push({
      mimeType: "text/html",
      body: { data: Buffer.from(mail.html).toString("base64url") },
    });
  }
  if (typeof mail.text === "string") {
    parts.push({
      mimeType: "text/plain",
      body: { data: Buffer.from(mail.text).toString("base64url") },
    });
  }
  mail.attachments.forEach((a, index) => {
    if (!isListedAttachment(a)) return;
    parts.push({
      filename: a.filename,
      mimeType: a.contentType,
      body: { attachmentId: String(index), size: a.size },
    });
  });

  const root = threadRoot({
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: referenceList(mail.references),
  });

  return {
    id: where.id,
    // A message with no Message-ID at all has no conversation to join: it threads on its own id.
    threadId: root.length > 0 ? threadToken(root) : threadToken(where.id),
    snippet: typeof mail.text === "string" ? mail.text.slice(0, 200).trim() : undefined,
    internalDate: mail.date === undefined ? undefined : String(mail.date.getTime()),
    labelIds: [where.label],
    payload: { headers, parts },
  };
}
