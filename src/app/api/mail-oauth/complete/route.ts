import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { completeRedirectPath, completeRelayConnect } from "@/features/email/relayComplete";
import { createContext } from "@/server/trpc/context";

// The relay's ticket is 32 random bytes in base64url.
const querySchema = z.object({ ticket: z.string().regex(/^[\w-]{20,100}$/) });

// GET /api/mail-oauth/complete?ticket=...: the last hop of a Gmail/Outlook connect. The mailbox is
// only bound when the person holding this browser session is the user who started the connect,
// so a consent link forwarded to someone else can never attach their mailbox to this account.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await createContext();
  if (ctx.session === null) return NextResponse.redirect(new URL("/login", env.BASE_URL));
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL(completeRedirectPath({ ok: false, error: { id: "E_MAIL_009" } }), env.BASE_URL),
    );
  }
  const outcome = await completeRelayConnect(
    db,
    { userId: ctx.session.userId, ticket: parsed.data.ticket },
    fetch,
    AbortSignal.timeout(10_000),
  );
  return NextResponse.redirect(new URL(completeRedirectPath(outcome), env.BASE_URL));
}
