/**
 * Per-IP request allowances for the unauthenticated edge.
 *
 * Sized to be far above real usage and far below what makes an endpoint a useful amplifier.
 * A legitimate caller should never see one of these; if a limit starts firing on real traffic,
 * that is a signal to look at why the traffic changed, not to raise the number reflexively.
 *
 * Window is expressed in ms to match createRateLimiter.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  // Registering an OAuth client is a once-per-integration act. Anything beyond a handful an
  // hour from one address is someone filling the table, not someone onboarding a client.
  oauthRegister: { limit: 5, windowMs: HOUR },
  // Access tokens live an hour (ACCESS_TOKEN_TTL_SECONDS), so a well-behaved client touches
  // this endpoint about once an hour per grant. The ceiling leaves room for many grants and
  // for retry storms without leaving room for grinding.
  oauthToken: { limit: 60, windowMs: MINUTE },
  // Starting a Google login is a human act with a redirect in the middle.
  authStart: { limit: 20, windowMs: MINUTE },
  // Each request sends a real email. A legitimate person retries a handful of times (typo,
  // slow inbox); anything beyond that from one address is someone else's inbox being spammed.
  authMagicLinkRequest: { limit: 5, windowMs: HOUR },
  // The container healthcheck polls every 15s (4/min). The rest of the headroom is for
  // whatever external monitoring an operator points at it.
  health: { limit: 60, windowMs: MINUTE },
  // Deliberately generous: a corporate mail gateway can NAT a whole company behind one address
  // and prefetch images for all of them. Exceeding this does not fail the request, it only
  // skips the recording (see the tracking routes), so a high ceiling costs nothing.
  emailTracking: { limit: 240, windowMs: MINUTE },
  // Per signed-in user, not per IP. Each attempt logs in to two remote servers with the given
  // credentials; a person fixing a typo needs a few tries, a credential-stuffing script needs many.
  imapConnect: { limit: 10, windowMs: HOUR },
  // Per OAuth access token holder (MCP client). A busy assistant session makes a few calls a
  // second at most; the ceiling stops a runaway loop from hammering the database.
  mcp: { limit: 300, windowMs: MINUTE },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;
