import { AppError } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import type { GmailMessage, HistoryList, MessageList, SendResult } from "./gmailSchemas";
import { toGmailMessageShape } from "./nylasMessageMap";
import { nylasMessageListSchema, nylasMessageSchema, nylasThreadSchema } from "./nylasSchemas";

export interface NylasClientConfig {
  apiKey: string;
  grantId: string;
  region: "us" | "eu";
}

function baseUrl(region: "us" | "eu"): string {
  return region === "eu" ? "https://api.eu.nylas.com" : "https://api.us.nylas.com";
}

async function nylasFetch<T>(
  url: string,
  init: RequestInit,
  schema: { parse: (u: unknown) => T },
  signal: AbortSignal,
): Promise<Result<T, AppError>> {
  const res = await fetch(url, { ...init, signal });
  signal.throwIfAborted();
  if (!res.ok) {
    // Nylas's error envelope is { request_id, error: { type, message } }; message names the
    // actual cause (expired grant, invalid scope, ...), mirroring how gmailClient.ts surfaces
    // oauthError from Gmail's own envelope for the same reason (syncFailureDetail logs it).
    const nylasError = await res
      .clone()
      .json()
      .then((b: unknown) =>
        typeof b === "object" && b !== null && "error" in b
          ? ((b as { error: { message?: string } }).error.message ?? null)
          : null,
      )
      .catch(() => null);
    return err(
      new AppError("E_NYLAS_001", "nylas call failed", {
        status: res.status,
        statusText: res.statusText,
        nylasError,
      }),
    );
  }
  const body: unknown = await res.json();
  signal.throwIfAborted();
  try {
    return ok(schema.parse(body));
  } catch {
    return err(new AppError("E_NYLAS_001", "nylas response failed schema validation", { body }));
  }
}

// Implements the SAME GmailClient interface gmailClient.ts does (see docs/superpowers/specs/
// 2026-09-25-nylas-email-integration-design.md): every one of the ~70 files that call through
// this interface (send.ts, sync consumers, attachment handling, spam sweep, trash, tracking...)
// work unchanged against this implementation instead.
//
// historyList is intentionally a no-op stub: Gmail's pull-based historyId sync has no Nylas
// equivalent (confirmed: no delta/history command anywhere in `nylas email --help`). Nylas
// accounts get new mail via a `message.created` webhook instead (a separate relay service, not
// this client), so historyList/syncCursor.ts's polling loop is simply never invoked for a
// Nylas-connected email_account (gated on which column is set: nylas_grant_id vs
// refresh_token_enc). If this ever DOES get called for a Nylas account, an empty history (no
// error) is the safe answer: the polling loop treats "nothing changed" as a normal, harmless
// outcome, whereas an error would trip its failure-handling/backoff for no real problem.
//
// sendRaw and trashThread are not yet implemented (checkpoint 4: send needs the MIME blob
// send.ts builds parsed back into Nylas's structured to/subject/body/attachments shape; trash
// needs Nylas's per-message folder-move semantics reconciled with Gmail's whole-thread trash
// concept). Calling either now returns a clear error rather than silently doing nothing.
export function createNylasClient(config: NylasClientConfig): GmailClient {
  const API = `${baseUrl(config.region)}/v3/grants/${config.grantId}`;
  const auth = { Authorization: `Bearer ${config.apiKey}` } as const;

  return {
    historyList({ startHistoryId, signal }): Promise<Result<HistoryList, AppError>> {
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: startHistoryId, history: [] }));
    },

    async getMessage({ id, signal }): Promise<Result<GmailMessage, AppError>> {
      const r = await nylasFetch(
        `${API}/messages/${id}`,
        { headers: auth },
        { parse: (u) => nylasMessageSchema.parse((u as { data: unknown }).data) },
        signal,
      );
      if (!r.ok) return r;
      return ok(toGmailMessageShape(r.value));
    },

    async getThread({ id, signal }) {
      const r = await nylasFetch(
        `${API}/threads/${id}`,
        { headers: auth },
        { parse: (u) => nylasThreadSchema.parse((u as { data: unknown }).data) },
        signal,
      );
      if (!r.ok) return r;
      // ponytail: every message reported as NOT trashed (empty labelIds). Nylas threads don't
      // carry a Gmail-style per-message TRASH label we can map here, so whole-thread trash
      // reconciliation (P4, threadTrash.ts) does not yet work correctly for Nylas-connected
      // accounts. Upgrade path: once trashRaw (checkpoint 4) lands, track trashed message ids
      // in our own DB instead of asking Nylas to report them back.
      return ok({
        id: r.value.id,
        messages: r.value.message_ids.map((mid) => ({ id: mid, labelIds: [] })),
      });
    },

    sendRaw(): Promise<Result<SendResult, AppError>> {
      return Promise.resolve(
        err(new AppError("E_NYLAS_002", "nylas sendRaw not yet implemented (checkpoint 4)", {})),
      );
    },

    async searchByRfc822({ messageIdHeader, signal }): Promise<Result<MessageList, AppError>> {
      const params = new URLSearchParams({ search_query_native: `rfc822msgid:${messageIdHeader}` });
      const r = await nylasFetch(
        `${API}/messages?${params.toString()}`,
        { headers: auth },
        nylasMessageListSchema,
        signal,
      );
      if (!r.ok) return r;
      return ok({ messages: r.value.data.map((m) => ({ id: m.id, threadId: m.thread_id })) });
    },

    async getAttachment({ messageId, attachmentId, signal }) {
      const params = new URLSearchParams({ message_id: messageId });
      const res = await fetch(`${API}/attachments/${attachmentId}/download?${params.toString()}`, {
        headers: auth,
        signal,
      });
      signal.throwIfAborted();
      if (!res.ok) {
        return err(
          new AppError("E_NYLAS_001", "nylas attachment download failed", {
            status: res.status,
            statusText: res.statusText,
          }),
        );
      }
      const bytes = await res.arrayBuffer();
      signal.throwIfAborted();
      return ok({ dataBase64: Buffer.from(bytes).toString("base64") });
    },

    async listMessages({ q, pageToken, signal }): Promise<Result<MessageList, AppError>> {
      const p = new URLSearchParams();
      if (q !== undefined) p.set("search_query_native", q);
      if (pageToken !== undefined) p.set("page_token", pageToken);
      const qs = p.toString();
      const r = await nylasFetch(
        `${API}/messages${qs.length > 0 ? `?${qs}` : ""}`,
        { headers: auth },
        nylasMessageListSchema,
        signal,
      );
      if (!r.ok) return r;
      return ok({
        messages: r.value.data.map((m) => ({ id: m.id, threadId: m.thread_id })),
        nextPageToken: r.value.next_cursor,
      });
    },

    getProfile({ signal }): Promise<Result<{ historyId: string }, AppError>> {
      // No Nylas equivalent of Gmail's historyId profile field; a Nylas-connected account never
      // consults this value (see the historyList note above), so any stable placeholder is fine.
      signal.throwIfAborted();
      return Promise.resolve(ok({ historyId: "0" }));
    },

    trashThread(): Promise<Result<{ id: string }, AppError>> {
      return Promise.resolve(
        err(
          new AppError("E_NYLAS_002", "nylas trashThread not yet implemented (checkpoint 4)", {}),
        ),
      );
    },
  };
}
