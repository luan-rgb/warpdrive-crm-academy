import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { AppContext } from "./context";
import { redactErrorShape } from "./errorFormatter";

const t = initTRPC.context<AppContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => redactErrorShape(shape),
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Rejects unauthenticated / dead-session / deactivated callers (rule 0).
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor === null || ctx.session === null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "E_AUTH_003" });
  }
  return next({ ctx: { ...ctx, actor: ctx.actor, session: ctx.session } });
});
