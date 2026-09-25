/**
 * Decodes a MIME message built by THIS repo's own buildMime (mime.ts) back into its structured
 * inputs, for nylasClient.ts's sendRaw: Nylas's send API takes structured to/subject/body/
 * attachments, not a raw MIME blob, but the GmailClient.sendRaw interface (used by outbox.ts and
 * sendSystem.ts, both already tested against it) only ever hands this a rawBase64 MIME string.
 *
 * This is deliberately NOT a general RFC822/MIME parser: it only needs to understand the exact,
 * deterministic shapes buildMime itself produces (see mime.ts) — a header block, then either a
 * bare text/html part, a multipart/alternative of text+html, optionally wrapped in
 * multipart/mixed with base64 attachment parts. A message from anywhere else is out of scope by
 * construction (sendRaw is never called with anyone else's MIME).
 */
import type { MimeAttachment } from "./mime";

export interface DecodedSelfBuiltMime {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  attachments: MimeAttachment[];
}

function splitAddressList(value: string): string[] {
  return value
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

// Reverses encodeHeaderWord (mime.ts): "=?UTF-8?B?<base64>?=" -> the original UTF-8 text.
// A header buildMime never encoded (pure ASCII) passes through unchanged.
function decodeHeaderWord(value: string): string {
  const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(value);
  if (m?.[1] === undefined) return value;
  return Buffer.from(m[1], "base64").toString("utf8");
}

// Headers end at the first blank line; buildMime always uses CRLF.
function parseHeaderBlock(text: string): { headers: Map<string, string>; rest: string } {
  const sep = text.indexOf("\r\n\r\n");
  const headerText = sep === -1 ? text : text.slice(0, sep);
  const rest = sep === -1 ? "" : text.slice(sep + 4);
  const headers = new Map<string, string>();
  // Header values here are always single-line (sanitizeHeaderValue strips CR/LF at build time),
  // so no unfolding of continuation lines is needed.
  for (const line of headerText.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { headers, rest };
}

function contentTypeOf(headers: Map<string, string>): { type: string; boundary?: string } {
  const raw = headers.get("content-type") ?? "";
  const type = (raw.split(";")[0] ?? "").trim().toLowerCase();
  const boundaryMatch = /boundary="([^"]+)"/.exec(raw);
  return { type, boundary: boundaryMatch?.[1] };
}

// buildMime always sets Content-Transfer-Encoding: base64 on every leaf part it emits.
function decodeBase64Part(body: string): string {
  return Buffer.from(body.trim(), "base64").toString("utf8");
}

// Splits a multipart body on its boundary into the raw text of each part (the epilogue after the
// closing "--boundary--" is discarded; buildMime never emits one).
function splitParts(body: string, boundary: string): string[] {
  return body
    .split(`--${boundary}`)
    .slice(1, -1) // drop the preamble before the first boundary and the "--" closing marker
    .map((p) => p.replace(/^\r\n/, "").replace(/\r\n$/, ""));
}

interface BodyResult {
  html: string;
  text?: string;
}

// A body part is either a bare text/html leaf, or a multipart/alternative wrapping text+html.
function decodeBodyPart(partText: string): BodyResult {
  const { headers, rest } = parseHeaderBlock(partText);
  const { type, boundary } = contentTypeOf(headers);
  if (type === "multipart/alternative" && boundary !== undefined) {
    let html = "";
    let text: string | undefined;
    for (const sub of splitParts(rest, boundary)) {
      const { headers: subHeaders, rest: subBody } = parseHeaderBlock(sub);
      const subType = contentTypeOf(subHeaders).type;
      if (subType === "text/html") html = decodeBase64Part(subBody);
      else if (subType === "text/plain") text = decodeBase64Part(subBody);
    }
    return { html, text };
  }
  return { html: decodeBase64Part(rest) };
}

function decodeAttachmentPart(partText: string): MimeAttachment {
  const { headers, rest } = parseHeaderBlock(partText);
  const contentType = headers.get("content-type") ?? "application/octet-stream";
  const disposition = headers.get("content-disposition") ?? "";
  const filenameMatch = /filename="((?:[^"\\]|\\.)*)"/.exec(disposition);
  const filename = (filenameMatch?.[1] ?? "attachment").replace(/\\(.)/g, "$1");
  return { filename, contentType, bytes: Buffer.from(rest.trim(), "base64") };
}

export function decodeSelfBuiltMime(rawBase64: string): DecodedSelfBuiltMime {
  const mime = Buffer.from(rawBase64, "base64url").toString("utf8");
  const { headers, rest } = parseHeaderBlock(mime);

  const { type: topType, boundary: topBoundary } = contentTypeOf(headers);
  let body: BodyResult;
  const attachments: MimeAttachment[] = [];

  if (topType === "multipart/mixed" && topBoundary !== undefined) {
    const parts = splitParts(rest, topBoundary);
    const [bodyPartText, ...attachmentPartTexts] = parts;
    body = bodyPartText === undefined ? { html: "" } : decodeBodyPart(bodyPartText);
    for (const p of attachmentPartTexts) attachments.push(decodeAttachmentPart(p));
  } else {
    // No multipart/mixed wrapper: the body part's own Content-Type header lives directly in the
    // top-level header block (this is exactly how buildMime emits the no-attachments case), so
    // re-parse the whole message as the body part itself.
    body = decodeBodyPart(mime);
  }

  return {
    from: headers.get("from") ?? "",
    to: splitAddressList(headers.get("to") ?? ""),
    cc: splitAddressList(headers.get("cc") ?? ""),
    bcc: splitAddressList(headers.get("bcc") ?? ""),
    subject: decodeHeaderWord(headers.get("subject") ?? ""),
    html: body.html,
    text: body.text,
    messageId: headers.get("message-id") ?? "",
    inReplyTo: headers.get("in-reply-to"),
    references: headers.get("references"),
    attachments,
  };
}
