import { describe, expect, it } from "vitest";
import { decodeThreadToken, threadToken } from "./imapIds";
import { toGmailMessageShape } from "./imapMessageMap";
import { parseGmailMessage } from "./mimeParse";

const RAW = [
  'From: "Silva, Ana" <ana@cliente.com.br>',
  "To: luan@provedor.com.br",
  "Cc: chefe@cliente.com.br",
  "Subject: =?UTF-8?B?UHJvcG9zdGEgY29tZXJjaWFs?=",
  "Date: Sun, 20 Sep 2026 12:00:00 +0000",
  "Message-ID: <c@cliente.com.br>",
  "In-Reply-To: <b@provedor.com.br>",
  "References: <a@cliente.com.br> <b@provedor.com.br>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="MIX"',
  "",
  "--MIX",
  'Content-Type: multipart/alternative; boundary="ALT"',
  "",
  "--ALT",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Olá",
  "--ALT",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Olá</p>",
  "--ALT--",
  "--MIX",
  'Content-Type: application/pdf; name="proposta.pdf"',
  'Content-Disposition: attachment; filename="proposta.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4").toString("base64"),
  "--MIX--",
  "",
].join("\r\n");

describe("IMAP source to Gmail shape", () => {
  it("decodes headers, bodies and threads by the References root", async () => {
    const shape = await toGmailMessageShape(Buffer.from(RAW), { id: "mid:x", label: "INBOX" });
    const parsed = parseGmailMessage(shape);
    expect(parsed.gmailMessageId).toBe("mid:x");
    expect(decodeThreadToken(parsed.threadId)).toBe("<a@cliente.com.br>");
    expect(parsed.threadId).toBe(threadToken("<a@cliente.com.br>"));
    expect(parsed.fromEmail).toBe("ana@cliente.com.br");
    expect(parsed.fromName).toBe("Silva, Ana");
    expect(parsed.toEmails).toEqual(["luan@provedor.com.br"]);
    expect(parsed.ccEmails).toEqual(["chefe@cliente.com.br"]);
    expect(parsed.subject).toBe("Proposta comercial");
    expect(parsed.bodyHtml).toBe("<p>Olá</p>");
    expect(parsed.bodyText?.trim()).toBe("Olá");
    expect(parsed.sentAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(shape.labelIds).toEqual(["INBOX"]);
  });

  it("exposes real attachments by position so they can be fetched again", async () => {
    const parsed = parseGmailMessage(
      await toGmailMessageShape(Buffer.from(RAW), { id: "mid:x", label: "INBOX" }),
    );
    expect(parsed.attachments).toEqual([
      {
        filename: "proposta.pdf",
        mimeType: "application/pdf",
        sizeBytes: 8,
        gmailAttachmentId: "0",
      },
    ]);
  });

  it("a bare message with no Message-ID threads on itself without crashing", async () => {
    const shape = await toGmailMessageShape(Buffer.from("Subject: oi\r\n\r\ntexto"), {
      id: "uid:y",
      label: "SENT",
    });
    expect(parseGmailMessage(shape).subject).toBe("oi");
    expect(shape.labelIds).toEqual(["SENT"]);
  });
});
