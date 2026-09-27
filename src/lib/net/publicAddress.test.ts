import { describe, expect, it } from "vitest";
import { isPublicAddress, resolvePublicHost } from "./publicAddress";

const lookupTo =
  (...addresses: string[]) =>
  () =>
    Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, CGNAT and mapped private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("93.184.216.34")).toBe(true);
  });
});

describe("resolvePublicHost", () => {
  it("returns a checked public address to connect to", async () => {
    const r = await resolvePublicHost("imap.example.com", lookupTo("93.184.216.34"));
    expect(r).toEqual({ ok: true, value: "93.184.216.34" });
  });

  it("refuses a name that resolves to an internal service (a Docker service name, for one)", async () => {
    const r = await resolvePublicHost("shared-postgres", lookupTo("172.18.0.2"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.id).toBe("E_MAIL_010");
  });

  it("refuses when any of the addresses is internal (no picking the public one to pass the check)", async () => {
    const r = await resolvePublicHost("mixed.example.com", lookupTo("93.184.216.34", "10.0.0.7"));
    expect(r.ok).toBe(false);
  });

  it("refuses literal internal IPs and names that do not resolve", async () => {
    expect((await resolvePublicHost("127.0.0.1", lookupTo("127.0.0.1"))).ok).toBe(false);
    const none = await resolvePublicHost("nope.invalid", () =>
      Promise.reject(new Error("ENOTFOUND")),
    );
    expect(none.ok).toBe(false);
  });
});
