import { describe, expect, test } from "vitest";
import { parseGmailMessage } from "./mimeParse";
import { type OutlookFolderIds, toGmailMessageShape } from "./outlookMessageMap";
import type { GraphMessage } from "./outlookSchemas";

const FOLDERS: OutlookFolderIds = { trash: "F-DEL", spam: "F-JUNK", sent: "F-SENT" };

// Shape as documented for GET /me/messages/{id} (learn.microsoft.com/graph/api/message-get).
const MESSAGE: GraphMessage = {
  id: "AAMk-immutable-1",
  conversationId: "AAQk-conv-1",
  subject: "Proposta comercial",
  from: { emailAddress: { name: "Silva, Ana", address: "ana@cliente.com.br" } },
  toRecipients: [{ emailAddress: { name: "Luan", address: "luan@outlook.com" } }],
  ccRecipients: [],
  body: { contentType: "html", content: "<p>Olá</p>" },
  bodyPreview: "Olá",
  sentDateTime: "2026-09-20T12:00:00Z",
  receivedDateTime: "2026-09-20T12:00:05Z",
  internetMessageId: "<abc@cliente.com.br>",
  parentFolderId: "F-INBOX",
  attachments: [
    {
      id: "ATT-1",
      name: "proposta.pdf",
      contentType: "application/pdf",
      size: 1234,
      isInline: false,
    },
    { id: "ATT-2", name: "logo.png", contentType: "image/png", size: 10, isInline: true },
  ],
};

describe("Outlook message to Gmail shape", () => {
  test("round-trips headers, body and ids through parseGmailMessage", () => {
    const parsed = parseGmailMessage(toGmailMessageShape(MESSAGE, FOLDERS));
    expect(parsed.gmailMessageId).toBe("AAMk-immutable-1");
    expect(parsed.threadId).toBe("AAQk-conv-1");
    expect(parsed.fromEmail).toBe("ana@cliente.com.br");
    expect(parsed.fromName).toBe("Silva, Ana");
    expect(parsed.toEmails).toEqual(["luan@outlook.com"]);
    expect(parsed.subject).toBe("Proposta comercial");
    expect(parsed.bodyHtml).toBe("<p>Olá</p>");
    expect(parsed.sentAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  test("plain-text bodies become a text/plain part", () => {
    const parsed = parseGmailMessage(
      toGmailMessageShape({ ...MESSAGE, body: { contentType: "text", content: "oi" } }, FOLDERS),
    );
    expect(parsed.bodyText).toBe("oi");
    expect(parsed.bodyHtml).toBeNull();
  });

  test("only non-inline attachments are exposed, keeping the Graph attachment id", () => {
    const parsed = parseGmailMessage(toGmailMessageShape(MESSAGE, FOLDERS));
    expect(parsed.attachments).toEqual([
      {
        filename: "proposta.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
        gmailAttachmentId: "ATT-1",
      },
    ]);
  });

  test("folder maps to Gmail-style labels so trash/spam reconciliation works", () => {
    expect(toGmailMessageShape({ ...MESSAGE, parentFolderId: "F-DEL" }, FOLDERS).labelIds).toEqual([
      "TRASH",
    ]);
    expect(toGmailMessageShape({ ...MESSAGE, parentFolderId: "F-JUNK" }, FOLDERS).labelIds).toEqual(
      ["SPAM"],
    );
    expect(toGmailMessageShape({ ...MESSAGE, parentFolderId: "F-SENT" }, FOLDERS).labelIds).toEqual(
      ["SENT"],
    );
    expect(toGmailMessageShape(MESSAGE, FOLDERS).labelIds).toEqual(["INBOX"]);
  });

  test("a message with no sender or body does not crash", () => {
    const shape = toGmailMessageShape({ ...MESSAGE, from: null, body: null }, FOLDERS);
    expect(parseGmailMessage(shape).fromEmail).toBe("");
  });
});
