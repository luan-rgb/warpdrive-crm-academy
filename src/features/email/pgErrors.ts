export const PG_UNIQUE_VIOLATION = "23505";

// Narrow an unknown thrown value to a Postgres error code. Drizzle wraps the pg
// error in its own Error and hangs the original off `.cause`, so walk the cause
// chain. Lets us catch the unique violation distinctly.
export function pgErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && typeof cur === "object" && cur !== null; depth++) {
    if ("code" in cur) {
      const code = cur.code;
      if (typeof code === "string") return code;
    }
    cur = "cause" in cur ? cur.cause : undefined;
  }
  return undefined;
}
