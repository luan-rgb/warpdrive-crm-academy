import { describe, expect, it } from "vitest";
import { isPublicAddress } from "@/lib/net/publicAddress";
import { runWebhook } from "./webhookRunner";

const sig = () => new AbortController().signal;
const DEAL = { id: "d1", ownerId: "u1" };
const LOAD = () => Promise.resolve({ id: "d1", title: "Acme", value: "10.00", status: "open" });

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local and CGNAT ranges (v4 and v6)", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.18.0.5",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});

describe("runWebhook", () => {
  it("refuses a URL that resolves to an internal address (no request is made)", async () => {
    let called = false;
    const r = await runWebhook(DEAL, { url: "http://shared-postgres:5432/" }, sig(), {
      lookup: () => Promise.resolve([{ address: "172.18.0.2", family: 4 }]),
      fetch: () => {
        called = true;
        return Promise.resolve(new Response(null));
      },
      loadDeal: LOAD,
    });
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/endereço interno/);
    expect(called).toBe(false);
  });

  it("POSTs the deal as JSON to a public URL, without following redirects", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const r = await runWebhook(DEAL, { url: "https://hooks.example.com/a" }, sig(), {
      lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      fetch: (url, init) => {
        seen.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
        return Promise.resolve(new Response("ok", { status: 200 }));
      },
      loadDeal: LOAD,
    });
    expect(r.status).toBe("success");
    expect(seen[0]?.init.method).toBe("POST");
    expect(seen[0]?.init.redirect).toBe("manual");
    expect(
      JSON.parse(typeof seen[0]?.init.body === "string" ? seen[0].init.body : ""),
    ).toMatchObject({
      deal: { id: "d1", title: "Acme" },
    });
  });

  it("a non-2xx answer is an error with the status", async () => {
    const r = await runWebhook(DEAL, { url: "https://hooks.example.com/a" }, sig(), {
      lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      fetch: () => Promise.resolve(new Response("no", { status: 500 })),
      loadDeal: LOAD,
    });
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/500/);
  });
});
