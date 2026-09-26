// Integration test against a real IMAP+SMTP server (GreenMail via @testcontainers/-style
// GenericContainer): the IMAP and SMTP protocol layers are infrastructure, same as Postgres, so
// they are exercised for real instead of mocked.
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImapClient, verifyImapSmtp } from "./imapClient";
import type { ImapConfig } from "./imapSettings";
import { buildMime, toRawBase64 } from "./mime";
import { parseGmailMessage } from "./mimeParse";

const USER = "luan@example.com";
const signal = (): AbortSignal => new AbortController().signal;

let container: StartedTestContainer;
let cfg: ImapConfig;

async function rawImap(): Promise<ImapFlow> {
  const c = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: false,
    auth: { user: USER, pass: "x" },
    logger: false,
  });
  await c.connect();
  return c;
}

async function deliverInbound(messageId: string, subject: string): Promise<void> {
  const t = createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: false });
  await t.sendMail({
    from: '"Ana" <ana@cliente.com.br>',
    to: USER,
    subject,
    text: "Olá",
    messageId,
    attachments: [{ filename: "proposta.pdf", content: Buffer.from("%PDF-1.4") }],
  });
}

beforeAll(async () => {
  container = await new GenericContainer("greenmail/standalone:2.1.3")
    .withEnvironment({
      GREENMAIL_OPTS:
        "-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled",
    })
    .withExposedPorts(3025, 3143)
    .withWaitStrategy(Wait.forLogMessage(/Starting GreenMail standalone/))
    .start();
  const host = container.getHost();
  cfg = {
    username: USER,
    password: "app-password",
    imap: { host, port: container.getMappedPort(3143), secure: false },
    smtp: { host, port: container.getMappedPort(3025), secure: false },
  };
  // Wait until IMAP accepts logins, then create the special folders a real provider ships with.
  for (let i = 0; ; i++) {
    try {
      const c = await rawImap();
      for (const f of ["Sent", "Trash", "Junk"]) await c.mailboxCreate(f).catch(() => undefined);
      await c.logout();
      break;
    } catch (e) {
      if (i > 30) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await deliverInbound("<a@cliente.com.br>", "Proposta");
}, 120_000);

afterAll(async () => {
  await container.stop();
});

describe("createImapClient against a real IMAP/SMTP server", () => {
  it("lists recent mail and returns it in the Gmail shape the sync pipeline reads", async () => {
    const client = createImapClient(cfg, { allowInsecure: true });
    try {
      const list = await client.listMessages({ signal: signal() });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.value.messages.length).toBe(1);
      const first = list.value.messages[0];
      if (first === undefined) return;

      const msg = await client.getMessage({ id: first.id, signal: signal() });
      expect(msg.ok).toBe(true);
      if (!msg.ok) return;
      const parsed = parseGmailMessage(msg.value);
      expect(parsed.fromEmail).toBe("ana@cliente.com.br");
      expect(parsed.subject).toBe("Proposta");
      expect(parsed.threadId).toBe(first.threadId);
      expect(msg.value.labelIds).toEqual(["INBOX"]);
      expect(parsed.attachments.map((a) => a.filename)).toEqual(["proposta.pdf"]);

      const att = await client.getAttachment({
        messageId: first.id,
        attachmentId: parsed.attachments[0]?.gmailAttachmentId ?? "",
        signal: signal(),
      });
      expect(att.ok && Buffer.from(att.value.dataBase64, "base64url").toString()).toBe("%PDF-1.4");
    } finally {
      await client.close();
    }
  });

  it("a fresh client (as every server action builds) still finds a message by its id", async () => {
    const lister = createImapClient(cfg, { allowInsecure: true });
    const list = await lister.listMessages({ signal: signal() });
    await lister.close();
    const id = list.ok ? list.value.messages[0]?.id : undefined;
    expect(id).toBeDefined();

    const fresh = createImapClient(cfg, { allowInsecure: true });
    try {
      const msg = await fresh.getMessage({ id: id ?? "", signal: signal() });
      expect(msg.ok).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  it("an unknown message id is reported as gone (404), not as a transient failure", async () => {
    const client = createImapClient(cfg, { allowInsecure: true });
    try {
      const msg = await client.getMessage({
        id: `mid:${Buffer.from("<nope@x>").toString("base64url")}`,
        signal: signal(),
      });
      expect(msg.ok).toBe(false);
      if (!msg.ok) expect(msg.error.context?.status).toBe(404);
    } finally {
      await client.close();
    }
  });

  it("sends a reply over SMTP, files it in Sent, and keeps it in the same conversation", async () => {
    const client = createImapClient(cfg, { allowInsecure: true });
    try {
      const mime = buildMime({
        from: USER,
        to: ["ana@cliente.com.br"],
        cc: [],
        bcc: ["segredo@example.com"],
        subject: "Re: Proposta",
        html: "<p>Segue</p>",
        messageId: "<r1@example.com>",
        inReplyTo: "<a@cliente.com.br>",
        references: "<a@cliente.com.br>",
      });
      const sent = await client.sendRaw({ rawBase64: toRawBase64(mime), signal: signal() });
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      const found = await client.searchByRfc822({
        messageIdHeader: "<r1@example.com>",
        signal: signal(),
      });
      expect(found.ok && found.value.messages).toEqual([sent.value]);

      const inbound = await client.listMessages({ signal: signal() });
      const inboundThread = inbound.ok ? inbound.value.messages[0]?.threadId : undefined;
      expect(sent.value.threadId).toBe(inboundThread);

      const thread = await client.getThread({ id: sent.value.threadId, signal: signal() });
      expect(thread.ok && thread.value.messages.map((m) => m.labelIds[0]).sort()).toEqual([
        "INBOX",
        "SENT",
      ]);

      // Bcc recipients must never be visible in the copy that went out.
      const imap = await rawImap();
      const lock = await imap.getMailboxLock("Sent");
      try {
        const copy = await imap.fetchOne("*", { source: true });
        const text = copy === false || copy === undefined ? "" : (copy.source?.toString() ?? "");
        expect(text).toContain("Re: Proposta");
        expect(text).not.toMatch(/segredo@example\.com/);
      } finally {
        lock.release();
        await imap.logout();
      }
    } finally {
      await client.close();
    }
  });

  it("trashThread moves the whole conversation to Trash", async () => {
    await deliverInbound("<t1@cliente.com.br>", "Para apagar");
    const client = createImapClient(cfg, { allowInsecure: true });
    try {
      const list = await client.listMessages({ signal: signal() });
      const target = list.ok
        ? list.value.messages.find(
            (m) => m.id === `mid:${Buffer.from("<t1@cliente.com.br>").toString("base64url")}`,
          )
        : undefined;
      expect(target).toBeDefined();
      if (target === undefined) return;

      const r = await client.trashThread({ threadId: target.threadId, signal: signal() });
      expect(r.ok).toBe(true);
      const thread = await client.getThread({ id: target.threadId, signal: signal() });
      expect(thread.ok && thread.value.messages.map((m) => m.labelIds)).toEqual([["TRASH"]]);
    } finally {
      await client.close();
    }
  });
});

describe("verifyImapSmtp", () => {
  it("accepts working credentials", async () => {
    const r = await verifyImapSmtp(cfg, signal(), { allowInsecure: true });
    expect(r.ok).toBe(true);
  });

  it("reports which side failed", async () => {
    const r = await verifyImapSmtp({ ...cfg, smtp: { ...cfg.smtp, port: 1 } }, signal(), {
      allowInsecure: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.id).toBe("E_MAIL_005");
      expect(r.error.context?.stage).toBe("smtp");
    }
  });
});
