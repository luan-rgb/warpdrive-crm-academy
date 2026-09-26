import { z } from "zod";
import { AppError } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";

export type OAuthMailProvider = "gmail" | "outlook";

// The relay (mail-oauth-relay/) names providers after the identity platform, the CRM after the
// mailbox.
const RELAY_PROVIDER: Record<OAuthMailProvider, "google" | "microsoft"> = {
  gmail: "google",
  outlook: "microsoft",
};

const connectInitResponse = z.object({ authUrl: z.string().url() });

// Tenants live at <slug>.<BASE_DOMAIN>; the slug is how the relay finds the tenant database.
export function tenantSlugFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).hostname.split(".")[0] ?? "";
}

// Ask the central relay for a Google/Microsoft consent URL for this user. The relay mints the
// single-use state and owns the one registered redirect_uri, so the browser never comes back to
// this tenant until the relay has stored the token.
export async function requestConsentUrl(
  args: {
    relayUrl: string;
    secret: string;
    tenantSlug: string;
    userId: string;
    provider: OAuthMailProvider;
  },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Result<{ url: string }, AppError>> {
  let res: Response;
  try {
    res = await fetchImpl(`${args.relayUrl}/connect-init`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": args.secret },
      body: JSON.stringify({
        tenant_slug: args.tenantSlug,
        user_id: args.userId,
        provider: RELAY_PROVIDER[args.provider],
      }),
      signal,
    });
  } catch (e) {
    signal.throwIfAborted();
    return err(
      new AppError("E_MAIL_007", "mail oauth relay unreachable", {
        cause: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  signal.throwIfAborted();
  if (!res.ok) {
    return err(new AppError("E_MAIL_007", "mail oauth relay refused", { status: res.status }));
  }
  const parsed = connectInitResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return err(new AppError("E_MAIL_007", "mail oauth relay reply invalid", {}));
  return ok({ url: parsed.data.authUrl });
}

const claimedMailbox = z.object({
  provider: z.enum(["gmail", "outlook"]),
  email: z.string().email(),
  refreshToken: z.string().min(1),
  scopes: z.array(z.string()),
});
export type ClaimedMailbox = z.infer<typeof claimedMailbox>;

// After consent the relay parks the result behind a single-use ticket and sends the browser here.
// Claiming it with the logged-in user's id is what ties the mailbox to the person who actually
// started the connection: the relay refuses any other user, tenant, reuse or late claim.
export async function claimRelayMailbox(
  args: { relayUrl: string; secret: string; tenantSlug: string; userId: string; ticket: string },
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Result<ClaimedMailbox, AppError>> {
  let res: Response;
  try {
    res = await fetchImpl(`${args.relayUrl}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-secret": args.secret },
      body: JSON.stringify({
        tenant_slug: args.tenantSlug,
        user_id: args.userId,
        ticket: args.ticket,
      }),
      signal,
    });
  } catch (e) {
    signal.throwIfAborted();
    return err(
      new AppError("E_MAIL_007", "mail oauth relay unreachable", {
        cause: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  signal.throwIfAborted();
  if (res.status === 404 || res.status === 400) {
    return err(new AppError("E_MAIL_009", "mail oauth relay refused the claim", {}));
  }
  if (!res.ok) {
    return err(new AppError("E_MAIL_007", "mail oauth relay refused", { status: res.status }));
  }
  const parsed = claimedMailbox.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return err(new AppError("E_MAIL_007", "mail oauth relay reply invalid", {}));
  return ok(parsed.data);
}
