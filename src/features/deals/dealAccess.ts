// Records that hang off a deal (products, invoices and their lines) carry no visibility of their
// own: they are exactly as visible and editable as the parent deal. Every read and write of them
// goes through authorizeDealAccess so an id guessed from another user's deal leads nowhere.
import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { dealProducts } from "@/db/schema/dealProducts";
import { invoiceLineItems } from "@/db/schema/invoiceLineItems";
import { invoices } from "@/db/schema/invoices";
import { toRefActor } from "@/features/contacts/actorAdapters";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { err, ok, type Result } from "@/types/result";
import { loadEditableDeal } from "./dealAuth";

export type DealTarget =
  | { dealId: string }
  | { dealProductId: string }
  | { invoiceId: string }
  | { invoiceLineId: string };

async function resolveDealId(db: Db, target: DealTarget): Promise<string | null> {
  if ("dealId" in target) return target.dealId;
  if ("dealProductId" in target) {
    const [row] = await db
      .select({ dealId: dealProducts.dealId })
      .from(dealProducts)
      .where(eq(dealProducts.id, target.dealProductId));
    return row?.dealId ?? null;
  }
  if ("invoiceId" in target) {
    const [row] = await db
      .select({ dealId: invoices.dealId })
      .from(invoices)
      .where(eq(invoices.id, target.invoiceId));
    return row?.dealId ?? null;
  }
  const [row] = await db
    .select({ dealId: invoices.dealId })
    .from(invoiceLineItems)
    .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
    .where(eq(invoiceLineItems.id, target.invoiceLineId));
  return row?.dealId ?? null;
}

// "read" = the actor can see the parent deal; "edit" = the actor can edit it (deal.edit rules).
// Both fail as not-found for an invisible deal, so existence never leaks.
export async function authorizeDealAccess(
  db: Db,
  actor: PermSetUser,
  target: DealTarget,
  mode: "read" | "edit",
  signal: AbortSignal,
): Promise<Result<{ dealId: string }, AppError>> {
  signal.throwIfAborted();
  const dealId = await resolveDealId(db, target);
  if (dealId === null) {
    return err(new AppError(ERROR_IDS.DEAL_NOT_FOUND, "not found", { target }));
  }
  if (mode === "edit") {
    const editable = await loadEditableDeal(db, actor, dealId, signal);
    return editable.ok ? ok({ dealId }) : editable;
  }
  const visible = await assertReferenceVisible(
    db,
    toRefActor(actor),
    { kind: "deal", id: dealId },
    signal,
  );
  return visible.ok ? ok({ dealId }) : visible;
}
