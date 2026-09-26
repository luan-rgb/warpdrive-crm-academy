import { describe, expect, it } from "vitest";
import {
  decodeMessageToken,
  decodeThreadToken,
  messageToken,
  threadRoot,
  threadToken,
} from "./imapIds";

describe("IMAP stable ids", () => {
  it("a message id round-trips through its token, whatever folder the message sits in", () => {
    const token = messageToken({
      messageId: "<abc@mail.com>",
      path: "INBOX",
      uidValidity: 7n,
      uid: 3,
    });
    expect(decodeMessageToken(token)).toEqual({ kind: "mid", messageId: "<abc@mail.com>" });
    // Same Message-ID found in Trash yields the same token, so moves never duplicate rows.
    expect(
      messageToken({ messageId: "<abc@mail.com>", path: "Trash", uidValidity: 1n, uid: 90 }),
    ).toBe(token);
  });

  it("falls back to folder + UIDVALIDITY + UID when there is no Message-ID", () => {
    const token = messageToken({ messageId: undefined, path: "INBOX", uidValidity: 7n, uid: 3 });
    expect(decodeMessageToken(token)).toEqual({
      kind: "uid",
      path: "INBOX",
      uidValidity: "7",
      uid: 3,
    });
  });

  it("rejects a token it did not produce", () => {
    expect(decodeMessageToken("garbage")).toBeNull();
    expect(decodeThreadToken("garbage")).toBeNull();
  });

  it("threads on the first References entry, then In-Reply-To, then the message itself", () => {
    expect(
      threadRoot({ messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] }),
    ).toBe("<a@x>");
    expect(threadRoot({ messageId: "<c@x>", inReplyTo: "<b@x>", references: [] })).toBe("<b@x>");
    expect(threadRoot({ messageId: "<c@x>", inReplyTo: undefined, references: [] })).toBe("<c@x>");
  });

  it("a thread token round-trips to its root Message-ID", () => {
    expect(decodeThreadToken(threadToken("<a@x>"))).toBe("<a@x>");
  });

  it("tokens are url-safe", () => {
    expect(
      messageToken({ messageId: "<a+b/c=@x>", path: "INBOX", uidValidity: 1n, uid: 1 }),
    ).toMatch(/^[A-Za-z0-9_:-]+$/);
  });
});
