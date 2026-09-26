import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookClient } from "./outlookClient";

const GRAPH = "https://graph.microsoft.com/v1.0/me";
const signal = (): AbortSignal => new AbortController().signal;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Route = (c: Call) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FOLDER_ROUTES: Route = (c) => {
  if (c.url === `${GRAPH}/mailFolders/deleteditems?$select=id`) return json(200, { id: "F-DEL" });
  if (c.url === `${GRAPH}/mailFolders/junkemail?$select=id`) return json(200, { id: "F-JUNK" });
  if (c.url === `${GRAPH}/mailFolders/sentitems?$select=id`) return json(200, { id: "F-SENT" });
  return undefined;
};

// Stub fetch with an ordered route table; unmatched requests fail the test loudly.
function stubGraph(...routes: Route[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? init.body : undefined,
      };
      calls.push(call);
      for (const r of [FOLDER_ROUTES, ...routes]) {
        const res = r(call);
        if (res !== undefined) return Promise.resolve(res);
      }
      return Promise.resolve(json(599, { error: { message: `unrouted ${call.method} ${url}` } }));
    }),
  );
  return calls;
}

const GRAPH_MESSAGE = {
  id: "M1",
  conversationId: "C1",
  subject: "Oi",
  from: { emailAddress: { name: "Ana", address: "ana@x.com" } },
  toRecipients: [{ emailAddress: { address: "me@outlook.com" } }],
  ccRecipients: [],
  body: { contentType: "html", content: "<p>oi</p>" },
  sentDateTime: "2026-09-20T12:00:00Z",
  parentFolderId: "F-DEL",
  attachments: [],
};

describe("createOutlookClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getMessage asks for immutable ids with the bearer token and maps folder to label", async () => {
    const calls = stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages/M1?`) ? json(200, GRAPH_MESSAGE) : undefined,
    );
    const r = await createOutlookClient("tok").getMessage({ id: "M1", signal: signal() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.threadId).toBe("C1");
    expect(r.value.labelIds).toEqual(["TRASH"]);
    const get = calls.find((c) => c.url.startsWith(`${GRAPH}/messages/M1?`));
    expect(get?.headers.Authorization).toBe("Bearer tok");
    expect(get?.headers.Prefer).toBe('IdType="ImmutableId"');
    expect(get?.url).toContain("$expand=attachments");
  });

  it("resolves the well-known folder ids once per client", async () => {
    const calls = stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages/M1?`) ? json(200, GRAPH_MESSAGE) : undefined,
    );
    const client = createOutlookClient("tok");
    await client.getMessage({ id: "M1", signal: signal() });
    await client.getMessage({ id: "M1", signal: signal() });
    expect(calls.filter((c) => c.url.includes("/mailFolders/")).length).toBe(3);
  });

  it("a Graph 404 surfaces as an error carrying status 404 (message gone)", async () => {
    stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages/GONE?`)
        ? json(404, { error: { code: "ErrorItemNotFound", message: "not found" } })
        : undefined,
    );
    const r = await createOutlookClient("tok").getMessage({ id: "GONE", signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.id).toBe("E_MAIL_003");
      expect(r.error.context?.status).toBe(404);
    }
  });

  it("listMessages returns recent non-draft messages and the next page link", async () => {
    const calls = stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages?`)
        ? json(200, {
            value: [{ id: "M1", conversationId: "C1" }],
            "@odata.nextLink": `${GRAPH}/messages?$skiptoken=abc`,
          })
        : undefined,
    );
    const r = await createOutlookClient("tok").listMessages({ signal: signal() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messages).toEqual([{ id: "M1", threadId: "C1" }]);
    expect(r.value.nextPageToken).toBe(`${GRAPH}/messages?$skiptoken=abc`);
    expect(decodeURIComponent(calls.at(-1)?.url ?? "")).toContain("isDraft eq false");
  });

  it("getThread lists the conversation and labels each message by folder", async () => {
    stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages?`) &&
      decodeURIComponent(c.url).includes("conversationId eq 'C1'")
        ? json(200, {
            value: [
              { id: "M1", conversationId: "C1", parentFolderId: "F-DEL" },
              { id: "M2", conversationId: "C1", parentFolderId: "F-INBOX" },
            ],
          })
        : undefined,
    );
    const r = await createOutlookClient("tok").getThread({ id: "C1", signal: signal() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.messages).toEqual([
        { id: "M1", labelIds: ["TRASH"] },
        { id: "M2", labelIds: ["INBOX"] },
      ]);
    }
  });

  it("sendRaw uploads the MIME as a draft, sends it, and returns the stable draft id", async () => {
    const calls = stubGraph(
      (c) =>
        c.method === "POST" && c.url === `${GRAPH}/messages`
          ? json(201, { id: "D1", conversationId: "C9" })
          : undefined,
      (c) =>
        c.method === "POST" && c.url === `${GRAPH}/messages/D1/send`
          ? new Response(null, { status: 202 })
          : undefined,
    );
    const raw = Buffer.from("Subject: hi\r\n\r\nbody").toString("base64url");
    const r = await createOutlookClient("tok").sendRaw({ rawBase64: raw, signal: signal() });
    expect(r).toEqual({ ok: true, value: { id: "D1", threadId: "C9" } });
    const create = calls.find((c) => c.url === `${GRAPH}/messages`);
    expect(create?.headers["content-type"]).toBe("text/plain");
    // Graph wants standard base64 of the MIME, not base64url.
    expect(Buffer.from(create?.body ?? "", "base64").toString()).toBe("Subject: hi\r\n\r\nbody");
  });

  it("a rejected draft upload is reported with its 4xx status (safe to retry)", async () => {
    stubGraph((c) =>
      c.method === "POST" && c.url === `${GRAPH}/messages`
        ? json(400, { error: { message: "bad mime" } })
        : undefined,
    );
    const r = await createOutlookClient("tok").sendRaw({ rawBase64: "eA", signal: signal() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.context?.status).toBe(400);
  });

  it("searchByRfc822 filters by internetMessageId", async () => {
    const calls = stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages?`)
        ? json(200, { value: [{ id: "M7", conversationId: "C7" }] })
        : undefined,
    );
    const r = await createOutlookClient("tok").searchByRfc822({
      messageIdHeader: "<x@y>",
      signal: signal(),
    });
    expect(r.ok && r.value.messages).toEqual([{ id: "M7", threadId: "C7" }]);
    expect(decodeURIComponent(calls.at(-1)?.url ?? "")).toContain("internetMessageId eq '<x@y>'");
  });

  it("getAttachment returns the bytes as base64url", async () => {
    stubGraph((c) =>
      c.url.startsWith(`${GRAPH}/messages/M1/attachments/A1`)
        ? json(200, { contentBytes: Buffer.from([0xfb, 0xff]).toString("base64") })
        : undefined,
    );
    const r = await createOutlookClient("tok").getAttachment({
      messageId: "M1",
      attachmentId: "A1",
      signal: signal(),
    });
    expect(r.ok && Buffer.from(r.value.dataBase64, "base64url")).toEqual(Buffer.from([0xfb, 0xff]));
  });

  it("trashThread moves every message of the conversation to Deleted Items", async () => {
    const calls = stubGraph(
      (c) =>
        c.url.startsWith(`${GRAPH}/messages?`)
          ? json(200, {
              value: [
                { id: "M1", conversationId: "C1" },
                { id: "M2", conversationId: "C1" },
              ],
            })
          : undefined,
      (c) =>
        c.method === "POST" && c.url.endsWith("/move")
          ? json(201, { id: "moved", conversationId: "C1" })
          : undefined,
    );
    const r = await createOutlookClient("tok").trashThread({ threadId: "C1", signal: signal() });
    expect(r).toEqual({ ok: true, value: { id: "C1" } });
    const moves = calls.filter((c) => c.url.endsWith("/move"));
    expect(moves.map((m) => m.url)).toEqual([
      `${GRAPH}/messages/M1/move`,
      `${GRAPH}/messages/M2/move`,
    ]);
    expect(JSON.parse(moves[0]?.body ?? "{}")).toEqual({ destinationId: "deleteditems" });
  });
});
