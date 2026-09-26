"use server";

import { AppError } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { checkRateLimitFor } from "@/server/rateLimitGuard";
import { createContext } from "@/server/trpc/context";
import { type ActionResult, clientErr, toClientResult } from "@/types/actionResult";
import { verifyImapSmtp } from "./imapClient";
import { connectImapMailbox } from "./imapConnect";
import { enqueueInitialSync } from "./syncScheduling";

// Settings > Email sync > "Outro provedor (IMAP/SMTP)". CSRF first, then the actor from the
// trusted context (never client identity); connectImapMailbox owns validation, the login check
// and persistence. The timeout covers two TLS handshakes plus logins on slow providers.
export async function connectImapAction(
  csrfToken: string | null,
  rawInput: unknown,
): Promise<ActionResult<{ accountId: string }>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return clientErr(new AppError("E_PERM_001", "csrf check failed", {}));

  const ctx = await createContext();
  if (ctx.actor === null) return clientErr(new AppError("E_PERM_001", "unauthenticated", {}));
  if (!checkRateLimitFor("imapConnect", ctx.actor.id).allowed) {
    return clientErr(new AppError("E_RATE_001", "too many imap connect attempts", {}));
  }

  return toClientResult(
    await connectImapMailbox(db, {
      userId: ctx.actor.id,
      rawInput,
      deps: { verify: (cfg, signal) => verifyImapSmtp(cfg, signal), enqueue: enqueueInitialSync },
      signal: AbortSignal.timeout(45_000),
    }),
  );
}
