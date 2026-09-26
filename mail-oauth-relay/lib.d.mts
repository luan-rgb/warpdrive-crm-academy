// Types for lib.mjs (the relay ships as plain Node ESM with no build step).
type Provider = "google" | "microsoft";
type Query = (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

export interface RelayConfig {
  baseDomain: string;
  relaySecret: string;
  google: { clientId: string; clientSecret: string };
  microsoft: { clientId: string; clientSecret: string };
}

export function relayConfigFromEnv(env: Record<string, string | undefined>): RelayConfig;
export function isValidSlug(slug: unknown): boolean;
export function tenantDbName(slug: string): string;
export function redirectUri(cfg: RelayConfig, provider: Provider): string;
export function buildAuthUrl(cfg: RelayConfig, provider: Provider, state: string): string;
export function encryptToken(keyBase64: string, plaintext: string): Buffer;
export function readEnvValue(text: string, name: string): string | null;
export function ensureOpsSchema(opsQuery: Query): Promise<void>;
export function connectInit(
  deps: { opsQuery: Query; cfg: RelayConfig },
  body: unknown,
  headerSecret: string | undefined,
): Promise<{ status: number; body: { authUrl: string } & Record<string, unknown> }>;
export function completeCallback(
  deps: {
    opsQuery: Query;
    tenantQuery: (slug: string) => Query;
    tenantKey: (slug: string) => Promise<string | null>;
    fetchImpl: typeof fetch;
    cfg: RelayConfig;
  },
  provider: string,
  query: URLSearchParams,
): Promise<string>;
