// Stable ids for IMAP mail. IMAP only has per-folder UIDs, which change when a message moves (sent,
// trashed, flagged as spam), but the CRM dedupes on (account_id, gmail_message_id). So the id is
// derived from the RFC 5322 Message-ID, which survives moves, and is reversible so a fresh client
// (every server action builds a new one) can find the message again with a HEADER search.

const MID = "mid:";
const UID = "uid:";
const THREAD = "t:";

const enc = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const dec = (s: string): string => Buffer.from(s, "base64url").toString("utf8");

export function messageToken(m: {
  messageId: string | undefined;
  path: string;
  uidValidity: bigint;
  uid: number;
}): string {
  if (m.messageId !== undefined && m.messageId.length > 0) return MID + enc(m.messageId);
  return UID + enc(`${m.path}\n${m.uidValidity.toString()}\n${String(m.uid)}`);
}

export type DecodedMessageToken =
  | { kind: "mid"; messageId: string }
  | { kind: "uid"; path: string; uidValidity: string; uid: number };

export function decodeMessageToken(token: string): DecodedMessageToken | null {
  if (token.startsWith(MID)) return { kind: "mid", messageId: dec(token.slice(MID.length)) };
  if (!token.startsWith(UID)) return null;
  const [path, uidValidity, uid] = dec(token.slice(UID.length)).split("\n");
  if (path === undefined || uidValidity === undefined || uid === undefined) return null;
  const n = Number(uid);
  return Number.isInteger(n) ? { kind: "uid", path, uidValidity, uid: n } : null;
}

// A conversation is identified by its first message: the head of References (RFC 5322 3.6.4
// orders it oldest first), else the parent in In-Reply-To, else the message itself. The sender
// side (sendRaw) and the sync side derive it from the same headers, so both agree.
export function threadRoot(h: {
  messageId: string | undefined;
  inReplyTo: string | undefined;
  references: string[];
}): string {
  return h.references[0] ?? h.inReplyTo ?? h.messageId ?? "";
}

export function threadToken(rootMessageId: string): string {
  return THREAD + enc(rootMessageId);
}

export function decodeThreadToken(token: string): string | null {
  return token.startsWith(THREAD) ? dec(token.slice(THREAD.length)) : null;
}
