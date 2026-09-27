import { AppError } from "@/constants/errorIds";

export interface SafeErrorSummary {
  name: string;
  id?: string;
  pgCode?: string;
}

// Drizzle wraps the pg error and hangs it off `.cause`; the SQLSTATE code is safe to log.
function postgresCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && typeof cur === "object" && cur !== null; depth++) {
    if ("code" in cur && typeof cur.code === "string" && /^[0-9A-Z]{5}$/.test(cur.code)) {
      return cur.code;
    }
    cur = "cause" in cur ? cur.cause : undefined;
  }
  return undefined;
}

// What to log for a caught error. Deliberately drops the message and context: a failed Drizzle
// query's message is the SQL plus every bound value (emails, names, token hashes), and logs are
// kept and shipped around far more loosely than the database itself.
export function safeErrorSummary(e: unknown): SafeErrorSummary {
  if (!(e instanceof Error)) return { name: typeof e };
  const out: SafeErrorSummary = { name: e.name };
  if (e instanceof AppError) out.id = e.id;
  const pgCode = postgresCode(e);
  if (pgCode !== undefined) out.pgCode = pgCode;
  return out;
}
