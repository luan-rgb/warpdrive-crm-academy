import type { ConnectNotice } from "./EmailSyncClient";

type Params = Record<string, string | string[] | undefined>;

// The relay (mail-oauth-relay/lib.mjs) sends the student back with ?connected=<provider> or
// ?connect_error=<code>. Only short lowercase codes are accepted; the copy for each lives in
// strings.ts, so nothing from the URL is ever rendered as-is.
export function parseConnectNotice(params: Params): ConnectNotice {
  const code = (v: string | string[] | undefined): string | null =>
    typeof v === "string" && /^[a-z_]{1,32}$/.test(v) ? v : null;
  const connected = code(params.connected);
  if (connected !== null) return { kind: "connected", code: connected };
  const failed = code(params.connect_error);
  if (failed !== null) return { kind: "error", code: failed };
  return null;
}
