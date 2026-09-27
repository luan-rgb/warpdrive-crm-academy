import { describe, expect, it } from "vitest";
import { sendEmailInput } from "./send";

const base = {
  accountId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  to: ["ana@acme.com"],
  subject: "Oi",
  bodyHtml: "<p>Oi</p>",
};

describe("sendEmailInput limits", () => {
  it("accepts a normal message", () => {
    expect(sendEmailInput.safeParse(base).success).toBe(true);
  });

  it("refuses absurd sizes that would only load the server and the mail provider", () => {
    expect(sendEmailInput.safeParse({ ...base, subject: "x".repeat(999) }).success).toBe(false);
    expect(sendEmailInput.safeParse({ ...base, bodyHtml: "x".repeat(5_000_001) }).success).toBe(
      false,
    );
    const many = Array.from({ length: 101 }, (_, i) => `p${i}@acme.com`);
    expect(sendEmailInput.safeParse({ ...base, to: many }).success).toBe(false);
    expect(sendEmailInput.safeParse({ ...base, bcc: many }).success).toBe(false);
    expect(sendEmailInput.safeParse({ ...base, threadId: "t".repeat(257) }).success).toBe(false);
  });
});
