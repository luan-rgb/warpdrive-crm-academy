import { describe, expect, it } from "vitest";
import { stripBccHeader } from "./imapSend";

describe("stripBccHeader", () => {
  it("drops the Bcc header (and its folded lines) but keeps everything else", () => {
    const mime = [
      "From: a@x.com",
      "To: b@x.com",
      "Bcc: c@x.com,",
      " d@x.com",
      "Subject: oi",
      "",
      "Bcc: this line is body text and stays",
    ].join("\r\n");
    expect(stripBccHeader(Buffer.from(mime)).toString()).toBe(
      [
        "From: a@x.com",
        "To: b@x.com",
        "Subject: oi",
        "",
        "Bcc: this line is body text and stays",
      ].join("\r\n"),
    );
  });

  it("leaves a message without Bcc untouched", () => {
    const mime = "From: a@x.com\r\nSubject: oi\r\n\r\ncorpo";
    expect(stripBccHeader(Buffer.from(mime)).toString()).toBe(mime);
  });
});
