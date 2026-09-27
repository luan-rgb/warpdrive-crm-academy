import { describe, expect, it } from "vitest";
import { presetForAddress } from "./imapPresets";

describe("presetForAddress", () => {
  it("finds the provider from the address domain, case-insensitively", () => {
    expect(presetForAddress("Luan@Yahoo.com.br")?.imap.host).toBe("imap.mail.yahoo.com");
    expect(presetForAddress("x@gmail.com")?.smtp.port).toBe(465);
  });

  it("returns nothing for a custom domain (the student picks a hosting preset or types it)", () => {
    expect(presetForAddress("vendas@minhaempresa.com.br")).toBeUndefined();
    expect(presetForAddress("sem-arroba")).toBeUndefined();
  });
});
