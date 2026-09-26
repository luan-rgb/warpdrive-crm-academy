"use server";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { makeStorageClient } from "@/features/files/storage";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { type ActionResult, clientErr, toClientResult } from "@/types/actionResult";
import { err, ok, type Result } from "@/types/result";
import { softDisconnectMailbox } from "./disconnect";
import type { GmailClient } from "./gmailClient";
import { assertMailboxOwner } from "./mailboxOwnership";
import { buildAuthUrl, GMAIL_OAUTH_STATE_COOKIE } from "./oauth";
import { resolveProductionClient } from "./productionClient";
import { sendEmail as orchestrateSend, type SendEmailInput, sendEmailInput } from "./send";
import { isFutureScheduledSend } from "./sendScheduling";
import { trashThread } from "./threadTrash";

// Stub Gmail client for the future-scheduled path: runSend enqueues + prepares the body
// then returns before any Gmail I/O, so this is never invoked. Any call is a programmer
// error (the scheduled path reached Gmail), so it throws.
function scheduledStubGmail(): GmailClient {
  const unreachable = (): never => {
    throw new AppError("E_GMAIL_009", "Gmail called on the future-scheduled send path", {});
  };
  return {
    sendRaw: unreachable,
    historyList: unreachable,
    getMessage: unreachable,
    getThread: unreachable,
    searchByRfc822: unreachable,
    getAttachment: unreachable,
    listMessages: unreachable,
    getProfile: unreachable,
    trashThread: unreachable,
  };
}

// Interactive send action. CSRF first (before any DB/actor work), then the actor from
// the trusted context (NEVER client identity), Zod-validate the input, build the real
// Gmail client, and orchestrate. Returns a discriminated Result for the caller.
export async function sendEmail(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<{ status: string; messageId?: string }>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError("E_PERM_001", "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null) return clientErr(new AppError("E_PERM_001", "unauthenticated", {}));

  const parsed = sendEmailInput.safeParse(rawInput);
  if (!parsed.success) {
    return clientErr(
      new AppError("E_GMAIL_009", "invalid send input", { issues: parsed.error.issues }),
    );
  }
  const input: SendEmailInput = parsed.data;

  const signal = AbortSignal.timeout(8000);
  // Ownership FIRST (F5): confirm the mailbox belongs to the actor before any token
  // decrypt/refresh side effect. runSend re-checks ownership (defense in depth), but a
  // non-owner must never reach ensureAccessToken and trigger refresh-token rotation.
  const owner = await assertMailboxOwner(db, input.accountId, ctx.actor.id, signal);
  if (!owner.ok) return clientErr(owner.error);

  // A future scheduled send never calls Gmail now: runSend enqueues + prepares the body,
  // then returns before Gmail I/O. Skip ensureAccessToken so we do NOT trigger a
  // refresh-token rotation (a side effect) for a token this request will never use.
  if (isFutureScheduledSend(input.scheduledSendAt, Date.now())) {
    return toClientResult(
      await orchestrateSend(db, {
        actorId: ctx.actor.id,
        actorType: ctx.actor.type,
        actorGroupIds: ctx.actor.groupIds,
        gmail: scheduledStubGmail(),
        storage: makeStorageClient(),
        input,
        signal,
      }),
    );
  }

  const client = await resolveProductionClient(db, input.accountId, signal);
  if (!client.ok) return clientErr(client.error);

  const gmail = client.value;
  return toClientResult(
    await orchestrateSend(db, {
      actorId: ctx.actor.id,
      actorType: ctx.actor.type,
      actorGroupIds: ctx.actor.groupIds,
      gmail,
      storage: makeStorageClient(),
      input,
      signal,
    }),
  );
}

// Reader Delete -> Gmail Trash (P4). CSRF first, then the trusted actor. Resolve the thread's
// mailbox OWNER-SCOPED before touching tokens: a non-owner must never reach ensureAccessToken (a
// refresh-token rotation side effect), same guard as sendEmail. Then build the real Gmail client
// and delegate to trashThread, which moves the Gmail conversation and stamps trashed_at on success.
export async function trashThreadAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<Result<{ threadId: string }, AppError>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return err(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null) return err(new AppError(ERROR_IDS.PERM_DENIED, "unauthenticated", {}));

  const parsed = z.object({ threadId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return err(
      new AppError(ERROR_IDS.GMAIL_TRASH_INPUT_INVALID, "invalid trash input", {
        issues: parsed.error.issues,
      }),
    );
  }

  const signal = SIG();
  const acct = (
    await db.execute(sql`
      SELECT a.id FROM email_threads t JOIN email_accounts a ON a.id = t.account_id
      WHERE t.id = ${parsed.data.threadId} AND a.user_id = ${ctx.actor.id}
    `)
  ).rows[0] as { id: string } | undefined;
  if (acct === undefined)
    return err(new AppError(ERROR_IDS.GMAIL_THREAD_NOT_FOUND, "thread not found", {}));

  const client = await resolveProductionClient(db, acct.id, signal);
  if (!client.ok) return client;

  const gmail = client.value;
  return trashThread(db, { actor: ctx.actor, threadId: parsed.data.threadId, gmail }, signal);
}

// Start the Gmail connect flow: mints a single-use OAuth state, stores it in an
// HttpOnly cookie (the callback compares it constant-time for login-CSRF defense),
// and returns the Google consent URL for the signed-in user. Route-guarded in the
// app flow; the no-session branch is a programmer error (unreachable when the UI
// gates this behind auth), so it throws AppError.
export async function connectGmailStart(): Promise<{ url: string }> {
  const ctx = await createContext();
  if (ctx.session === null) {
    throw new AppError("E_AUTH_001", "connectGmailStart called without a session", {});
  }

  const state = randomUUID();
  const jar = await cookies();
  jar.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // single-use, short-lived; cleared by the callback after use
  });

  return { url: buildAuthUrl({ userId: ctx.session.userId, state }) };
}

// Gmail/Outlook via Nylas (src/features/email/nylasClient.ts): unlike connectGmailStart above,
// no per-request state cookie here, because the redirect the user follows never comes back to
// THIS tenant directly — Nylas's hosted auth has one fixed redirect_uri for every tenant (see
// docs/superpowers/specs/2026-09-25-nylas-email-integration-design.md), so the callback lands on
// the shared-nylas-relay service instead, which is also where the single-use state is minted and
// checked. This action's only job is asking that service for the URL to send the browser to.
export async function connectNylasStart(
  provider: "google" | "microsoft",
): Promise<{ url: string }> {
  const ctx = await createContext();
  if (ctx.session === null) {
    throw new AppError("E_AUTH_001", "connectNylasStart called without a session", {});
  }
  const tenantSlug = new URL(env.BASE_URL).hostname.split(".")[0] ?? "";

  const res = await fetch("http://shared-nylas-relay:8081/connect-init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_slug: tenantSlug, user_id: ctx.session.userId, provider }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new AppError("E_NYLAS_001", "connect-init failed", { status: res.status });
  }
  const body = (await res.json()) as { authUrl: string };
  return { url: body.authUrl };
}

const disconnectMailboxInput = z.object({ accountId: z.string().uuid() });

// Disconnect the actor's Gmail mailbox (Settings > Email sync). CSRF first (before any DB or
// actor work), then the actor from the trusted context (NEVER client identity), then Zod-parse
// the input at the boundary, then ownership (F5: a non-owner must never mutate another user's
// mailbox), then a soft disconnect (status -> disconnected, token nulled, row retained so FK'd
// mail history survives and a later reconnect reuses the same row). Never logs tokens.
export async function disconnectMailboxAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<Result<{ disconnected: true }, AppError>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return err(new AppError("E_PERM_001", "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null) return err(new AppError("E_PERM_001", "unauthenticated", {}));

  const parsed = disconnectMailboxInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      new AppError("E_GMAIL_013", "invalid disconnect input", { issues: parsed.error.issues }),
    );
  }

  const signal = SIG();
  const owner = await assertMailboxOwner(db, parsed.data.accountId, ctx.actor.id, signal);
  if (!owner.ok) return owner;

  await softDisconnectMailbox(db, parsed.data.accountId, signal);
  return ok({ disconnected: true });
}
