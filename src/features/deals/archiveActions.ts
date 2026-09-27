"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { archiveDeal } from "./archiveDeal";
import { archiveDeals } from "./bulkArchive";
import { bulkArchiveInput } from "./schemas";

export type ArchiveResult = { ok: true } | { ok: false; error: { id: string } };

export type BulkArchiveResult = { ok: true; count: number } | { ok: false; error: { id: string } };

export async function archiveDealAction(
  input: { dealId: string; archived?: boolean },
  csrfToken: string | null = null,
): Promise<ArchiveResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  const r = await archiveDeal(
    db,
    actor,
    { dealId: input.dealId, archived: input.archived ?? true },
    SIG(),
  );
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true };
}

export async function archiveDealsAction(
  ids: string[],
  archived: boolean,
  csrfToken: string | null = null,
): Promise<BulkArchiveResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  const parsed = bulkArchiveInput.safeParse({ ids, archived });
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.DEAL_BULK_INPUT_INVALID } };
  const r = await archiveDeals(db, actor, parsed.data.ids, parsed.data.archived, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, count: r.value };
}
