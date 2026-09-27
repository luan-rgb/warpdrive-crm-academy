import { BlockList, isIP } from "node:net";
import { AppError } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";

// Addresses user-supplied hosts (automation webhooks, IMAP/SMTP servers) may never reach. Tenants
// share one Docker network with the shared Postgres, MinIO, the mail relay and every other
// student's app, so an unfiltered host would be a request-forgery path into all of them (and into
// the cloud metadata endpoint).
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1] !== undefined) return isPublicAddress(mapped[1]);
  const family = isIP(ip);
  if (family === 0) return false;
  return !BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export type HostLookup = (host: string) => Promise<{ address: string; family: number }[]>;

// Resolve once and hand back the checked address: the caller connects to THAT address, so a DNS
// answer that changes between the check and the connect (rebinding) cannot sneak inside. Every
// address must be public; otherwise a name with one public and one private record would pass.
export async function resolvePublicHost(
  host: string,
  lookup: HostLookup,
): Promise<Result<string, AppError>> {
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) !== 0 ? [{ address: host }] : await lookup(host);
  } catch {
    return err(new AppError("E_MAIL_010", "host does not resolve", { host }));
  }
  const first = addresses[0];
  if (first === undefined || !addresses.every((a) => isPublicAddress(a.address))) {
    return err(new AppError("E_MAIL_010", "host resolves to an internal address", { host }));
  }
  return ok(first.address);
}
