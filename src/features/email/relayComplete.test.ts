import { describe, expect, it } from "vitest";
import { completeRedirectPath } from "./relayComplete";

describe("completeRedirectPath", () => {
  it("sends a successful connect back to the settings page with the provider", () => {
    expect(completeRedirectPath({ ok: true, value: { provider: "outlook" } })).toBe(
      "/settings/email-sync?connected=outlook",
    );
  });

  it("maps each failure to a short code the settings page knows how to explain", () => {
    const fail = (id: string) => completeRedirectPath({ ok: false, error: { id } });
    expect(fail("E_MAIL_009")).toBe("/settings/email-sync?connect_error=claim");
    expect(fail("E_GMAIL_006")).toBe("/settings/email-sync?connect_error=taken");
    expect(fail("E_MAIL_007")).toBe("/settings/email-sync?connect_error=tenant");
    expect(fail("E_OTHER")).toBe("/settings/email-sync?connect_error=tenant");
  });
});
