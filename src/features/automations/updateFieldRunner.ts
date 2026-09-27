import { eq } from "drizzle-orm";
import { BOARD_EVENT, dealChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { users } from "@/db/schema/identity";
import { stages } from "@/db/schema/stages";
import { recordChange } from "@/features/collaboration/changeLog";
import { publishBoardEvent } from "@/server/realtime/events";
import type { ActionOutcome, DealRef } from "./actionOutcome";
import { failed, succeeded } from "./actionOutcome";
import { AUTOMATION_UPDATE_FIELDS, isAutomationUpdateField } from "./updateFields";

// Checks that need the database: a stage must belong to the deal's own pipeline and an owner must
// be an active user. Returns an error message (pt-BR, shown in the run history) or null.
async function referenceProblem(
  db: Db,
  field: string,
  value: string,
  pipelineId: string,
): Promise<string | null> {
  if (field === "stageId") {
    const [stage] = await db
      .select({ pipelineId: stages.pipelineId })
      .from(stages)
      .where(eq(stages.id, value));
    return stage?.pipelineId === pipelineId ? null : "a etapa não pertence ao funil do negócio";
  }
  if (field === "ownerId") {
    const [user] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, value));
    return user?.isActive === true ? null : "o responsável escolhido não existe ou está inativo";
  }
  return null;
}

// Writes one deal column directly. Deliberately does NOT go through updateDeal()/moveDeal(): their
// trailing automation evaluation would let this same rule re-fire on the change it just made, so
// recursion is prevented by construction. The change log entry and live board event are still
// written, so the edit shows in the deal history and on open boards like a user edit would.
export async function runUpdateField(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  const fieldKey = config.fieldKey;
  if (!isAutomationUpdateField(fieldKey)) {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "campo não suportado nesta ação");
  }
  const parsed = AUTOMATION_UPDATE_FIELDS[fieldKey].parse(
    typeof config.value === "string" || typeof config.value === "number"
      ? String(config.value)
      : "",
  );
  if (parsed === null) {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "valor inválido para o campo escolhido");
  }
  const [before] = await db.select().from(deals).where(eq(deals.id, deal.id));
  if (before === undefined) return failed(ERROR_IDS.DEAL_NOT_FOUND, "o negócio não existe mais");

  const problem = await referenceProblem(db, fieldKey, parsed, before.pipelineId);
  signal.throwIfAborted();
  if (problem !== null) return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, problem);

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({ [fieldKey]: parsed })
      .where(eq(deals.id, deal.id));
    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: deal.id,
        field: fieldKey,
        oldValue: before[fieldKey],
        newValue: parsed,
        actorId: deal.ownerId,
      },
      signal,
    );
    await publishBoardEvent(
      tx,
      {
        channel: dealChannel(deal.id),
        type: BOARD_EVENT.dealUpdated,
        actorId: deal.ownerId,
        data: { dealId: deal.id },
      },
      signal,
    );
  });
  return succeeded({ fieldKey, value: parsed });
}
