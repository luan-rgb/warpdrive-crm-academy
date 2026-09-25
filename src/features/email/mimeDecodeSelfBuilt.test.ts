/**
 * mimeDecodeSelfBuilt.test.ts: round-trip tests against the REAL buildMime (mime.ts), covering
 * every shape it can produce:
 * (a) simplest: no text alternative, no attachments (bare text/html body).
 * (b) with a text/plain alternative (multipart/alternative).
 * (c) with attachments (multipart/mixed wrapping the body part + N attachment parts).
 * (d) cc/bcc/inReplyTo/references present.
 * (e) a non-ASCII subject (RFC 2047 encoded-word) decodes back to the original text.
 */
import { describe, expect, test } from "vitest";
import { buildMime, toRawBase64 } from "./mime";
import { decodeSelfBuiltMime } from "./mimeDecodeSelfBuilt";

describe("decodeSelfBuiltMime", () => {
  test("simplest shape: bare text/html, no attachments, no text alternative", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com"],
      subject: "Hello",
      html: "<p>hi</p>",
      messageId: "<m1@example.com>",
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.from).toBe("sender@example.com");
    expect(decoded.to).toEqual(["a@example.com"]);
    expect(decoded.cc).toEqual([]);
    expect(decoded.bcc).toEqual([]);
    expect(decoded.subject).toBe("Hello");
    expect(decoded.html).toBe("<p>hi</p>");
    expect(decoded.text).toBeUndefined();
    expect(decoded.messageId).toBe("<m1@example.com>");
    expect(decoded.attachments).toEqual([]);
  });

  test("multipart/alternative: text + html both recovered", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com", "b@example.com"],
      cc: ["c@example.com"],
      bcc: ["d@example.com"],
      subject: "With text",
      html: "<p>hi</p>",
      text: "hi",
      messageId: "<m2@example.com>",
      inReplyTo: "<m1@example.com>",
      references: "<m1@example.com>",
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.to).toEqual(["a@example.com", "b@example.com"]);
    expect(decoded.cc).toEqual(["c@example.com"]);
    expect(decoded.bcc).toEqual(["d@example.com"]);
    expect(decoded.html).toBe("<p>hi</p>");
    expect(decoded.text).toBe("hi");
    expect(decoded.inReplyTo).toBe("<m1@example.com>");
    expect(decoded.references).toBe("<m1@example.com>");
  });

  test("with attachments: multipart/mixed body + attachment bytes recovered", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com"],
      subject: "With attachment",
      html: "<p>see attached</p>",
      messageId: "<m3@example.com>",
      attachments: [
        { filename: "invoice.pdf", contentType: "application/pdf", bytes: Buffer.from("PDF-DATA") },
        { filename: "photo.png", contentType: "image/png", bytes: Buffer.from("PNG-DATA") },
      ],
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.html).toBe("<p>see attached</p>");
    expect(decoded.attachments).toHaveLength(2);
    expect(decoded.attachments[0]).toEqual({
      filename: "invoice.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("PDF-DATA"),
    });
    expect(decoded.attachments[1]?.filename).toBe("photo.png");
    expect(decoded.attachments[1]?.bytes.toString()).toBe("PNG-DATA");
  });

  test("attachments AND a text alternative together", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com"],
      subject: "Both",
      html: "<p>hi</p>",
      text: "hi",
      messageId: "<m4@example.com>",
      attachments: [{ filename: "a.txt", contentType: "text/plain", bytes: Buffer.from("data") }],
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.html).toBe("<p>hi</p>");
    expect(decoded.text).toBe("hi");
    expect(decoded.attachments).toHaveLength(1);
    expect(decoded.attachments[0]?.filename).toBe("a.txt");
  });

  test("non-ASCII subject (RFC 2047 encoded-word) decodes back to the original text", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com"],
      subject: "Olá, tudo bem?",
      html: "<p>oi</p>",
      messageId: "<m5@example.com>",
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.subject).toBe("Olá, tudo bem?");
  });

  test("a filename containing a quote/backslash round-trips (Content-Disposition escaping)", () => {
    const mime = buildMime({
      from: "sender@example.com",
      to: ["a@example.com"],
      subject: "Weird filename",
      html: "<p>hi</p>",
      messageId: "<m6@example.com>",
      attachments: [
        { filename: 'weird "file".txt', contentType: "text/plain", bytes: Buffer.from("x") },
      ],
    });
    const decoded = decodeSelfBuiltMime(toRawBase64(mime));
    expect(decoded.attachments[0]?.filename).toBe('weird "file".txt');
  });
});
