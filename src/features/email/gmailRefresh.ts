import { env } from "@/config/env";
import { AppError } from "@/constants/errorIds";
import {
  GOOGLE_TOKEN_URL,
  MICROSOFT_TOKEN_URL,
  OUTLOOK_MAILBOX_SCOPES,
} from "@/constants/mailOAuth";
import { err, ok, type Result } from "@/types/result";
import { tokenResponseSchema } from "./gmailSchemas";

// Token endpoint + client per OAuth provider. Gmail prefers the mailbox client
// (GMAIL_OAUTH_*, used by the central relay) and falls back to the sign-in client for
// single-tenant installs that connected Gmail through /api/gmail/oauth/callback.
function tokenRequest(provider: "gmail" | "outlook", refreshToken: string) {
  if (provider === "outlook") {
    return {
      url: MICROSOFT_TOKEN_URL,
      body: new URLSearchParams({
        client_id: env.MICROSOFT_OAUTH_CLIENT_ID,
        client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: OUTLOOK_MAILBOX_SCOPES.join(" "),
      }),
    };
  }
  const useMailbox = env.GMAIL_OAUTH_CLIENT_ID !== "";
  return {
    url: GOOGLE_TOKEN_URL,
    body: new URLSearchParams({
      client_id: useMailbox ? env.GMAIL_OAUTH_CLIENT_ID : env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: useMailbox ? env.GMAIL_OAUTH_CLIENT_SECRET : env.GOOGLE_OAUTH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  };
}

// Build the deps.refresh callback ensureAccessToken (Task 7) needs: exchange a stored
// refresh token for a fresh access token at Google's token endpoint. Shared by the
// interactive send action and the system-send primitive so there is one refresh path.
// Only OAuth error=invalid_grant means the grant is genuinely revoked (E_GMAIL_002,
// which disconnects the account and nulls the stored refresh token). Every other non-OK,
// including config errors like invalid_client/invalid_request that also return 4xx, is
// transient (E_GMAIL_001) so a single misconfiguration can never destroy refresh tokens
// across mailboxes (F32). A rotated refresh_token is passed through so it gets re-encrypted.
// Threaded with the request signal so an aborted send cannot keep the refresh alive.
export function makeRefresh(
  signal: AbortSignal,
  provider: "gmail" | "outlook" = "gmail",
): (
  refreshToken: string,
) => Promise<Result<{ accessToken: string; expiresIn: number; refreshToken?: string }, AppError>> {
  return async (refreshToken: string) => {
    const req = tokenRequest(provider, refreshToken);
    const res = await fetch(req.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: req.body,
      signal,
    });
    signal.throwIfAborted();
    if (!res.ok) {
      // Classify by the OAuth error code (RFC 6749, same for Google and Microsoft), not the raw status: only invalid_grant
      // definitively means the grant was revoked. Anything unparseable stays transient.
      const oauthError = await res
        .clone()
        .json()
        .then((b: unknown) =>
          typeof b === "object" && b !== null && "error" in b ? b.error : null,
        )
        .catch(() => null);
      const id = oauthError === "invalid_grant" ? "E_GMAIL_002" : "E_GMAIL_001";
      return err(new AppError(id, "token refresh failed", { status: res.status, oauthError }));
    }
    const parsed = tokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) return err(new AppError("E_GMAIL_001", "token response invalid", {}));
    return ok({
      accessToken: parsed.data.access_token,
      expiresIn: parsed.data.expires_in,
      refreshToken: parsed.data.refresh_token,
    });
  };
}
