import { lookup as dnsLookup } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import { AppError } from "@/constants/errorIds";
import { resolvePublicHost } from "@/lib/net/publicAddress";
import { err, ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import type { MessageList } from "./gmailSchemas";
import {
  decodeMessageToken,
  decodeThreadToken,
  messageToken,
  threadRoot,
  threadToken,
} from "./imapIds";
import { isListedAttachment, toGmailMessageShape } from "./imapMessageMap";
import { stripBccHeader } from "./imapSend";
import type { ImapConfig } from "./imapSettings";

// How far back one poll looks, and how many messages per folder it hands to sync. Sync dedupes on
// the message id, so re-listing the same recent messages every tick is harmless.
const LOOKBACK_DAYS = 14;
const PER_FOLDER_LIMIT = 25;
const IDLE_CLOSE_MS = 30_000;

type Role = "INBOX" | "SENT" | "SPAM" | "TRASH";
const SPECIAL_USE: Record<Exclude<Role, "INBOX">, string> = {
  SENT: "\\Sent",
  SPAM: "\\Junk",
  TRASH: "\\Trash",
};

export interface ImapClientOptions {
  // Test-only: GreenMail speaks neither TLS nor STARTTLS. Production always requires one of them,
  // so a password is never sent in clear text.
  allowInsecure?: boolean;
  // Test-only: GreenMail runs on a private Docker address and a non-standard port.
  allowPrivateHosts?: boolean;
}

// The only ports a mailbox may use. Anything else (5432, 9000, 3000...) is another service on the
// shared Docker network, and the connect form would become a port scanner.
const MAIL_PORTS = { imap: new Set([143, 993]), smtp: new Set([25, 465, 587, 2525]) };

// Resolve the configured host once, refuse internal addresses and non-mail ports, and return the
// checked IP to connect to (TLS still validates the certificate against the original host name).
async function safeEndpoint(
  side: "imap" | "smtp",
  endpoint: { host: string; port: number },
  opts: ImapClientOptions,
): Promise<Result<string, AppError>> {
  if (opts.allowPrivateHosts === true) return ok(endpoint.host);
  if (!MAIL_PORTS[side].has(endpoint.port)) {
    return err(
      new AppError("E_MAIL_010", "port is not a mail port", { side, port: endpoint.port }),
    );
  }
  const resolved = await resolvePublicHost(endpoint.host, (h) => dnsLookup(h, { all: true }));
  if (!resolved.ok) return err(new AppError("E_MAIL_010", resolved.error.message, { side }));
  return resolved;
}

export interface ImapMailClient extends GmailClient {
  close(): Promise<void>;
}

interface Located {
  path: string;
  uid: number;
  label: Role;
}

function imapError(message: string, context: Record<string, unknown>): AppError {
  return new AppError("E_MAIL_004", message, context);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function openImap(cfg: ImapConfig, opts: ImapClientOptions, address: string): ImapFlow {
  return new ImapFlow({
    host: address,
    servername: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.secure,
    doSTARTTLS: cfg.imap.secure || opts.allowInsecure === true ? undefined : true,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

function smtpTransport(cfg: ImapConfig, opts: ImapClientOptions, address: string) {
  return createTransport({
    host: address,
    tls: { servername: cfg.smtp.host },
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    requireTLS: !cfg.smtp.secure && opts.allowInsecure !== true,
    auth: { user: cfg.username, pass: cfg.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

// Generic IMAP (read) + SMTP (send) mailbox behind the GmailClient interface, for providers that
// are neither Gmail nor Outlook. One IMAP session is opened lazily, shared by the calls of one
// sync job or action, and closed after IDLE_CLOSE_MS without use so long-lived workers never hold
// idle connections (providers cap concurrent sessions per account).
export function createImapClient(cfg: ImapConfig, opts: ImapClientOptions = {}): ImapMailClient {
  let session: Promise<ImapFlow> | null = null;
  let folders: Map<Role, string> | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  const located = new Map<string, Located>();

  async function close(): Promise<void> {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    const s = session;
    session = null;
    folders = null;
    if (s === null) return;
    const c = await s.catch(() => null);
    await c?.logout().catch(() => c.close());
  }

  async function withImap<T>(
    signal: AbortSignal,
    fn: (c: ImapFlow) => Promise<Result<T, AppError>>,
  ): Promise<Result<T, AppError>> {
    signal.throwIfAborted();
    if (idleTimer !== null) clearTimeout(idleTimer);
    try {
      session ??= (async () => {
        const address = await safeEndpoint("imap", cfg.imap, opts);
        if (!address.ok) throw address.error;
        const c = openImap(cfg, opts, address.value);
        await c.connect();
        return c;
      })();
      const c = await session;
      signal.throwIfAborted();
      return await fn(c);
    } catch (e) {
      if (signal.aborted) {
        await close();
        throw e;
      }
      // A broken session is dropped so the next call reconnects instead of reusing it.
      await close();
      return err(imapError("imap operation failed", { status: 503, cause: describe(e) }));
    } finally {
      idleTimer = setTimeout(() => void close(), IDLE_CLOSE_MS);
      idleTimer.unref();
    }
  }
  async function folderMap(c: ImapFlow): Promise<Map<Role, string>> {
    if (folders !== null) return folders;
    const map = new Map<Role, string>([["INBOX", "INBOX"]]);
    for (const box of await c.list()) {
      for (const [role, flag] of Object.entries(SPECIAL_USE) as [
        Exclude<Role, "INBOX">,
        string,
      ][]) {
        if (box.specialUse === flag && !map.has(role)) map.set(role, box.path);
      }
    }
    folders = map;
    return map;
  }

  // Search one folder under its lock; UIDs come back ascending.
  async function searchIn(c: ImapFlow, path: string, query: Parameters<ImapFlow["search"]>[0]) {
    const lock = await c.getMailboxLock(path);
    try {
      const uids = await c.search(query, { uid: true });
      return Array.isArray(uids) ? uids : [];
    } finally {
      lock.release();
    }
  }

  // Header summary of some UIDs in one folder: the id and thread tokens sync needs.
  async function summarize(c: ImapFlow, path: string, role: Role, uids: number[]) {
    if (uids.length === 0) return [];
    const lock = await c.getMailboxLock(path);
    try {
      const uidValidity = c.mailbox === false ? 0n : c.mailbox.uidValidity;
      const out: { id: string; threadId: string; label: Role }[] = [];
      for await (const m of c.fetch(
        uids,
        { uid: true, envelope: true, headers: ["references"] },
        { uid: true },
      )) {
        const references = (m.headers?.toString() ?? "")
          .replace(/^references:/i, "")
          .split(/\s+/)
          .filter((s) => s.startsWith("<"));
        const messageId = m.envelope?.messageId;
        const id = messageToken({ messageId, path, uidValidity, uid: m.uid });
        const root = threadRoot({ messageId, inReplyTo: m.envelope?.inReplyTo, references });
        located.set(id, { path, uid: m.uid, label: role });
        out.push({ id, threadId: threadToken(root.length > 0 ? root : id), label: role });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async function locate(c: ImapFlow, id: string): Promise<Located | null> {
    const cached = located.get(id);
    if (cached !== undefined) return cached;
    const token = decodeMessageToken(id);
    if (token === null) return null;
    const map = await folderMap(c);
    for (const [role, path] of map) {
      if (token.kind === "uid") {
        if (token.path !== path) continue;
        const status = await c.status(path, { uidValidity: true });
        if (status.uidValidity?.toString() !== token.uidValidity) return null;
        return { path, uid: token.uid, label: role };
      }
      const uids = await searchIn(c, path, { header: { "message-id": token.messageId } });
      const uid = uids.at(-1);
      if (uid !== undefined) {
        const hit = { path, uid, label: role };
        located.set(id, hit);
        return hit;
      }
    }
    return null;
  }

  async function source(c: ImapFlow, at: Located): Promise<Buffer | null> {
    const lock = await c.getMailboxLock(at.path);
    try {
      const m = await c.fetchOne(String(at.uid), { source: true }, { uid: true });
      return m === false || m === undefined ? null : (m.source ?? null);
    } finally {
      lock.release();
    }
  }

  const notFound = (id: string) => err(imapError("message not found", { status: 404, id }));

  async function threadMembers(c: ImapFlow, threadId: string) {
    const root = decodeThreadToken(threadId);
    if (root === null) return [];
    const out: { id: string; threadId: string; label: Role }[] = [];
    for (const [role, path] of await folderMap(c)) {
      const uids = await searchIn(c, path, {
        or: [
          { header: { "message-id": root } },
          { header: { references: root } },
          { header: { "in-reply-to": root } },
        ],
      });
      out.push(...(await summarize(c, path, role, uids)).filter((m) => m.threadId === threadId));
    }
    return out;
  }

  return {
    close,

    historyList({ startHistoryId, signal }) {
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: startHistoryId, history: [] }));
    },

    getProfile({ signal }) {
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: "0" }));
    },

    listMessages({ includeSpamTrash, signal }) {
      return withImap(signal, async (c): Promise<Result<MessageList, AppError>> => {
        const map = await folderMap(c);
        const roles: Role[] =
          includeSpamTrash === true ? ["SPAM"] : ["INBOX", "SENT", "SPAM", "TRASH"];
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
        const messages: { id: string; threadId: string }[] = [];
        for (const role of roles) {
          const path = map.get(role);
          if (path === undefined) continue;
          const uids = (await searchIn(c, path, { since })).slice(-PER_FOLDER_LIMIT);
          for (const m of await summarize(c, path, role, uids)) {
            messages.push({ id: m.id, threadId: m.threadId });
          }
          signal.throwIfAborted();
        }
        return ok({ messages });
      });
    },

    getMessage({ id, signal }) {
      return withImap(signal, async (c) => {
        const at = await locate(c, id);
        if (at === null) return notFound(id);
        const raw = await source(c, at);
        if (raw === null) return notFound(id);
        return ok(await toGmailMessageShape(raw, { id, label: at.label }));
      });
    },

    getThread({ id, signal }) {
      return withImap(signal, async (c) => {
        const members = await threadMembers(c, id);
        return ok({ id, messages: members.map((m) => ({ id: m.id, labelIds: [m.label] })) });
      });
    },

    getAttachment({ messageId, attachmentId, signal }) {
      return withImap(signal, async (c) => {
        const at = await locate(c, messageId);
        const raw = at === null ? null : await source(c, at);
        if (raw === null) return notFound(messageId);
        const mail = await simpleParser(raw);
        const att = mail.attachments[Number(attachmentId)];
        if (att === undefined || !isListedAttachment(att)) return notFound(attachmentId);
        return ok({ dataBase64: att.content.toString("base64url") });
      });
    },

    searchByRfc822({ messageIdHeader, signal }) {
      return withImap(signal, async (c) => {
        const id = messageToken({ messageId: messageIdHeader, path: "", uidValidity: 0n, uid: 0 });
        located.delete(id);
        const at = await locate(c, id);
        if (at === null) return ok({ messages: [] });
        const [summary] = await summarize(c, at.path, at.label, [at.uid]);
        return ok({
          messages: summary === undefined ? [] : [{ id: summary.id, threadId: summary.threadId }],
        });
      });
    },

    trashThread({ threadId, signal }) {
      return withImap(signal, async (c) => {
        const trash = (await folderMap(c)).get("TRASH");
        if (trash === undefined) {
          return err(imapError("mailbox has no Trash folder", { status: 409 }));
        }
        for (const m of await threadMembers(c, threadId)) {
          const at = located.get(m.id);
          if (at === undefined || at.path === trash) continue;
          const lock = await c.getMailboxLock(at.path);
          try {
            await c.messageMove(String(at.uid), trash, { uid: true });
          } finally {
            lock.release();
          }
          located.delete(m.id);
        }
        return ok({ id: threadId });
      });
    },

    async sendRaw({ rawBase64, signal }) {
      signal.throwIfAborted();
      const mime = Buffer.from(rawBase64, "base64url");
      const mail = await simpleParser(mime, { skipHtmlToText: true, skipTextToHtml: true });
      const addrs = (a: typeof mail.to) =>
        (a === undefined ? [] : Array.isArray(a) ? a : [a])
          .flatMap((o) => o.value)
          .map((v) => v.address)
          .filter((v): v is string => typeof v === "string");
      const outgoing = stripBccHeader(mime);
      const smtpAddress = await safeEndpoint("smtp", cfg.smtp, opts);
      if (!smtpAddress.ok) return smtpAddress;
      try {
        await smtpTransport(cfg, opts, smtpAddress.value).sendMail({
          envelope: {
            from: addrs(mail.from)[0] ?? cfg.username,
            to: [...addrs(mail.to), ...addrs(mail.cc), ...addrs(mail.bcc)],
          },
          raw: outgoing,
        });
      } catch (e) {
        signal.throwIfAborted();
        return err(smtpFailure(e));
      }
      signal.throwIfAborted();

      const references =
        mail.references === undefined
          ? []
          : Array.isArray(mail.references)
            ? mail.references
            : mail.references.split(/\s+/);
      const root = threadRoot({ messageId: mail.messageId, inReplyTo: mail.inReplyTo, references });
      const id = messageToken({ messageId: mail.messageId, path: "", uidValidity: 0n, uid: 0 });

      // Gmail files SMTP-sent mail in Sent by itself; every other provider needs the copy appended.
      if (!/(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(cfg.smtp.host)) {
        const filed = await withImap(signal, async (c) => {
          const sent = (await folderMap(c)).get("SENT");
          if (sent !== undefined) await c.append(sent, outgoing, ["\\Seen"]);
          return ok(null);
        });
        // The message is already delivered; failing to file the copy must not make the outbox
        // retry (and duplicate) it. Sync simply won't see a Sent copy for this one.
        if (!filed.ok) return ok({ id, threadId: threadToken(root.length > 0 ? root : id) });
      }
      return ok({ id, threadId: threadToken(root.length > 0 ? root : id) });
    },
  };
}

// SMTP failures the server answered with a permanent 5xx, or an auth/envelope refusal, mean the
// message was NOT accepted: report them as a 4xx so the outbox treats a retry as a safe fresh
// send. Anything else (timeouts, dropped connections) is ambiguous and must reconcile.
function smtpFailure(e: unknown): AppError {
  const x = e as { responseCode?: number; code?: string };
  const definite =
    (typeof x.responseCode === "number" && x.responseCode >= 500) ||
    x.code === "EAUTH" ||
    x.code === "EENVELOPE";
  return imapError("smtp send failed", {
    status: definite ? 400 : 503,
    smtpCode: x.responseCode,
    cause: describe(e),
  });
}

// Log in to both servers before a mailbox is saved, so a typo in a host, port or app password is
// caught in the form rather than surfacing later as silent sync failures.
export async function verifyImapSmtp(
  cfg: ImapConfig,
  signal: AbortSignal,
  opts: ImapClientOptions = {},
): Promise<Result<void, AppError>> {
  signal.throwIfAborted();
  const imapAddress = await safeEndpoint("imap", cfg.imap, opts);
  if (!imapAddress.ok) return imapAddress;
  const smtpAddress = await safeEndpoint("smtp", cfg.smtp, opts);
  if (!smtpAddress.ok) return smtpAddress;
  signal.throwIfAborted();
  const imap = openImap(cfg, opts, imapAddress.value);
  try {
    await imap.connect();
    await imap.logout();
  } catch (e) {
    imap.close();
    signal.throwIfAborted();
    return err(
      new AppError("E_MAIL_005", "imap login failed", { stage: "imap", cause: describe(e) }),
    );
  }
  signal.throwIfAborted();
  const smtp = smtpTransport(cfg, opts, smtpAddress.value);
  try {
    await smtp.verify();
  } catch (e) {
    signal.throwIfAborted();
    return err(
      new AppError("E_MAIL_005", "smtp login failed", { stage: "smtp", cause: describe(e) }),
    );
  } finally {
    smtp.close();
  }
  return ok(undefined);
}
