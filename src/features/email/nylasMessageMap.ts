import type { GmailMessage, GmailPart } from "./gmailSchemas";
import type { NylasMessage } from "./nylasSchemas";

// Gmail's "Name <email>" header token. Always quote a present name: splitAddresses (mimeParse.ts)
// only tears an unquoted comma apart, so quoting costs nothing for a plain name and is required
// for one that itself contains a comma ("Doe, John").
function toHeaderToken(p: { name?: string; email: string }): string {
  if (p.name === undefined || p.name.length === 0) return p.email;
  return `"${p.name.replace(/"/g, '\\"')}" <${p.email}>`;
}

function toAddressListHeader(participants: { name?: string; email: string }[]): string {
  return participants.map(toHeaderToken).join(", ");
}

// Synthesizes just enough of a Gmail-shaped `payload` (headers + one body part + attachment
// stubs) for parseGmailMessage/extractAttachments (mimeParse.ts, attachmentParse.ts) to read
// unmodified: those two stay Gmail-specific parsers, this is the one place that knows Nylas's
// already-decoded shape is different and bridges it, rather than teaching them a second input
// shape each. See nylasMessageMap.test.ts for the exact fields this depends on.
export function toGmailMessageShape(msg: NylasMessage): GmailMessage {
  const headers: NonNullable<GmailPart["headers"]> = [];
  const from = msg.from[0];
  if (from !== undefined) headers.push({ name: "From", value: toHeaderToken(from) });
  if (msg.to.length > 0) headers.push({ name: "To", value: toAddressListHeader(msg.to) });
  if (msg.cc.length > 0) headers.push({ name: "Cc", value: toAddressListHeader(msg.cc) });
  if (msg.subject !== undefined) headers.push({ name: "Subject", value: msg.subject });
  if (msg.date !== undefined) {
    headers.push({ name: "Date", value: new Date(msg.date * 1000).toUTCString() });
  }

  const bodyPart: GmailPart | undefined =
    msg.body === undefined
      ? undefined
      : {
          mimeType: "text/html",
          body: { data: Buffer.from(msg.body, "utf8").toString("base64url") },
        };

  const attachmentParts: GmailPart[] = msg.attachments
    .filter((a) => a.filename !== undefined && a.filename.length > 0)
    .map((a) => ({
      filename: a.filename,
      mimeType: a.content_type ?? "application/octet-stream",
      body: { attachmentId: a.id, size: a.size },
    }));

  return {
    id: msg.id,
    threadId: msg.thread_id,
    snippet: msg.snippet,
    internalDate: msg.date === undefined ? undefined : String(msg.date * 1000),
    labelIds: [],
    payload: {
      headers,
      parts: bodyPart === undefined ? attachmentParts : [bodyPart, ...attachmentParts],
    },
  };
}
