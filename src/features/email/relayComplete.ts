import { env } from "@/config/env";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { bindOAuthMailbox } from "./relayBind";
import { claimRelayMailbox, tenantSlugFromBaseUrl } from "./relayConnect";

type Outcome = Result<{ provider: "gmail" | "outlook" }, { id: string }>;

// The relay sends the browser to /api/mail-oauth/complete?ticket=...: claim the parked consent for
// the logged-in user (the relay refuses anyone else) and store it under this tenant's own key.
export async function completeRelayConnect(
  db: Db,
  args: { userId: string; ticket: string },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Result<{ provider: "gmail" | "outlook" }, AppError>> {
  const claimed = await claimRelayMailbox(
    {
      relayUrl: env.MAIL_OAUTH_RELAY_URL,
      secret: env.MAIL_OAUTH_RELAY_SECRET,
      tenantSlug: tenantSlugFromBaseUrl(env.BASE_URL),
      userId: args.userId,
      ticket: args.ticket,
    },
    fetchImpl,
    signal,
  );
  if (!claimed.ok) return claimed;
  const bound = await bindOAuthMailbox(db, args.userId, claimed.value);
  if (!bound.ok) return err(bound.error);
  return ok({ provider: claimed.value.provider });
}

// Short codes only (the settings page maps them to copy in strings.ts); nothing from an error is
// ever echoed into the URL.
export function completeRedirectPath(outcome: Outcome): string {
  if (outcome.ok) return `/settings/email-sync?connected=${outcome.value.provider}`;
  const code =
    outcome.error.id === "E_MAIL_009"
      ? "claim"
      : outcome.error.id === "E_GMAIL_006"
        ? "taken"
        : "tenant";
  return `/settings/email-sync?connect_error=${code}`;
}
