/**
 * nylasMessageMap.test.ts: TDD tests for toGmailMessageShape.
 *
 * Nylas returns a message already decoded (a flat `body` string, structured `from`/`to`/`cc`
 * arrays), not Gmail's raw MIME payload tree. Rather than teach parseGmailMessage/
 * extractAttachments a second input shape, this synthesizes just enough of a Gmail-shaped
 * `payload` (headers + one body part + attachment stubs) that those two Gmail-specific parsers
 * read correctly unmodified. Test plan:
 * (a) a real captured Nylas message (fixture below, from `nylas email list --json` against a
 *     live connected Gmail grant) round-trips through parseGmailMessage with the right
 *     from/to/subject/body.
 * (b) cc is included when present, omitted (empty) when absent.
 * (c) a display name containing a comma survives (quoted so splitAddresses' comma-in-quotes
 *     handling doesn't tear it apart).
 * (d) attachments map through with the Nylas attachment id preserved (needed later by
 *     getAttachment), and are skipped when absent.
 * (e) an absent body doesn't crash the mapping (no body part is not the same failure mode as an
 *     empty string body).
 */

import { describe, expect, test } from "vitest";
import { parseGmailMessage } from "./mimeParse";
import { toGmailMessageShape } from "./nylasMessageMap";
import type { NylasMessage } from "./nylasSchemas";

// Real shape captured live via `nylas email list --limit 1 --json` against
// luan@estrategistacrm.com.br's connected Gmail grant (2026-09-25).
const REAL_CAPTURED_MESSAGE: NylasMessage = {
  id: "1a0da46a701f7d85",
  thread_id: "1a0da46a701f7d85",
  subject: "Your Nylas sandbox is ready",
  from: [{ name: "Joel Garcia", email: "tips@nylas.com" }],
  to: [{ email: "luan@estrategistacrm.com.br" }],
  cc: [],
  body: "<p>hello</p>",
  snippet: "hello",
  date: 1790000000,
  attachments: [],
};

describe("toGmailMessageShape + parseGmailMessage round-trip", () => {
  test("real captured message: from/to/subject/body come through correctly", () => {
    const parsed = parseGmailMessage(toGmailMessageShape(REAL_CAPTURED_MESSAGE));
    expect(parsed.gmailMessageId).toBe("1a0da46a701f7d85");
    expect(parsed.threadId).toBe("1a0da46a701f7d85");
    expect(parsed.fromEmail).toBe("tips@nylas.com");
    expect(parsed.fromName).toBe("Joel Garcia");
    expect(parsed.toEmails).toEqual(["luan@estrategistacrm.com.br"]);
    expect(parsed.ccEmails).toEqual([]);
    expect(parsed.subject).toBe("Your Nylas sandbox is ready");
    expect(parsed.bodyHtml).toBe("<p>hello</p>");
  });

  test("cc present: comes through; cc absent: empty array, not a crash", () => {
    const withCc = toGmailMessageShape({
      ...REAL_CAPTURED_MESSAGE,
      cc: [{ email: "watcher@example.com" }],
    });
    expect(parseGmailMessage(withCc).ccEmails).toEqual(["watcher@example.com"]);

    const withoutCc = toGmailMessageShape({ ...REAL_CAPTURED_MESSAGE, cc: [] });
    expect(parseGmailMessage(withoutCc).ccEmails).toEqual([]);
  });

  test("a display name containing a comma survives (quoted in the synthesized header)", () => {
    const msg = toGmailMessageShape({
      ...REAL_CAPTURED_MESSAGE,
      from: [{ name: "Doe, John", email: "j@example.com" }],
    });
    const parsed = parseGmailMessage(msg);
    expect(parsed.fromEmail).toBe("j@example.com");
    expect(parsed.fromName).toBe("Doe, John");
  });

  test("attachments map through with the Nylas attachment id preserved", () => {
    const msg = toGmailMessageShape({
      ...REAL_CAPTURED_MESSAGE,
      attachments: [
        { id: "att_1", filename: "invoice.pdf", content_type: "application/pdf", size: 1234 },
      ],
    });
    const parsed = parseGmailMessage(msg);
    expect(parsed.attachments).toEqual([
      {
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
        gmailAttachmentId: "att_1",
      },
    ]);
  });

  test("no attachments: empty array", () => {
    const msg = toGmailMessageShape({ ...REAL_CAPTURED_MESSAGE, attachments: [] });
    expect(parseGmailMessage(msg).attachments).toEqual([]);
  });

  test("absent body: null, not a crash", () => {
    const msg = toGmailMessageShape({ ...REAL_CAPTURED_MESSAGE, body: undefined });
    const parsed = parseGmailMessage(msg);
    expect(parsed.bodyHtml).toBeNull();
  });
});
