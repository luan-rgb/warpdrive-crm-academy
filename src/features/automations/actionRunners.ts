import { eq } from "drizzle-orm";
import { BOARD_EVENT, dealChannel } from "@/constants/boardChannels";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AutomationRuleAction, AutomationRunActionStatus } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
import { emailAccounts } from "@/db/schema/email";
import { users } from "@/db/schema/identity";
import { persons } from "@/db/schema/persons";
import { createActivity } from "@/features/activities/repo";
import { recordChange } from "@/features/collaboration/changeLog";
import { sendGmail } from "@/features/email/sendSystem";
import { toPermSetUser } from "@/features/mcp/actorContext";
import { createNotification } from "@/features/notifications/produce";
import { hydrateActor } from "@/server/hydrateActor";
import { publishBoardEvent } from "@/server/realtime/events";
import { renderTemplate } from "./template";

export interface ActionOutcome {
  status: AutomationRunActionStatus;
  errorMessage: string | null;
  resultSummary: Record<string, unknown> | null;
}

// The minimum a caller must know about a deal to run an action against it. actionRunners.test.ts
// seeds only { id, ownerId } directly (it does not go through the job.ts full-row select), so this
// stays the parameter type rather than the full deals row: any action that needs more (title,
// value, personId) re-reads it from `deal.id` itself instead of trusting what the caller passed.
// A full deals row (as job.ts passes) satisfies this shape structurally with no cast needed.
export interface DealRef {
  id: string;
  ownerId: string;
}

function ok(resultSummary: Record<string, unknown>): ActionOutcome {
  return { status: "success", errorMessage: null, resultSummary };
}

function failed(errorId: string, message: string): ActionOutcome {
  return { status: "error", errorMessage: `${errorId}: ${message}`, resultSummary: null };
}

interface DealTemplateContext {
  title: string;
  value: string | null;
  personId: string | null;
  ownerName: string;
}

async function loadDealTemplateContext(
  db: Db,
  deal: DealRef,
  signal: AbortSignal,
): Promise<DealTemplateContext | null> {
  signal.throwIfAborted();
  const [row] = await db
    .select({
      title: deals.title,
      value: deals.value,
      personId: deals.personId,
      ownerName: users.name,
    })
    .from(deals)
    .innerJoin(users, eq(users.id, deals.ownerId))
    .where(eq(deals.id, deal.id));
  return row ?? null;
}

async function runCreateActivity(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const actor = await hydrateActor(db, deal.ownerId, signal);
  if (actor === null) {
    return failed(ERROR_IDS.AUTOMATION_NOT_FOUND, "deal owner is missing or inactive");
  }
  const result = await createActivity(
    db,
    toPermSetUser(actor),
    {
      typeId: config.activityTypeId as string,
      subject: config.subject as string,
      dealId: deal.id,
      assigneeId: deal.ownerId,
    },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  return ok({ activityId: result.value.id });
}

async function runSendNotification(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const ctx = await loadDealTemplateContext(db, deal, signal);
  if (ctx === null) {
    return failed(ERROR_IDS.DEAL_NOT_FOUND, "deal no longer exists");
  }
  const message = renderTemplate(
    typeof config.messageTemplate === "string" ? config.messageTemplate : "",
    ctx,
  );
  const result = await createNotification(
    db,
    {
      recipientId: deal.ownerId,
      type: "automation",
      entityType: "deal",
      entityId: deal.id,
      actorId: null,
      payload: { message },
    },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  if ("suppressed" in result.value) {
    return ok({ suppressed: true });
  }
  return ok({ notificationId: result.value.notificationId });
}

async function runSendEmail(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, deal.ownerId));
  if (account === undefined || account.status !== "connected") {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_ACCOUNT_MISSING,
      "deal owner has no connected Gmail account",
    );
  }
  const ctx = await loadDealTemplateContext(db, deal, signal);
  if (ctx === null) {
    return failed(ERROR_IDS.DEAL_NOT_FOUND, "deal no longer exists");
  }
  if (ctx.personId === null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "deal has no linked person to email",
    );
  }
  const [person] = await db
    .select({ primaryEmail: persons.primaryEmail })
    .from(persons)
    .where(eq(persons.id, ctx.personId));
  if (person?.primaryEmail == null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "linked person has no primary email",
    );
  }
  const result = await sendGmail(
    account,
    {
      to: [person.primaryEmail],
      subject: renderTemplate(
        typeof config.subjectTemplate === "string" ? config.subjectTemplate : "",
        ctx,
      ),
      bodyHtml: renderTemplate(
        typeof config.bodyTemplate === "string" ? config.bodyTemplate : "",
        ctx,
      ),
    },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  return ok({ messageId: result.value.gmailMessageId });
}

async function runUpdateField(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  const fieldKey = typeof config.fieldKey === "string" ? config.fieldKey : "";
  const value = config.value;
  // Phase 1 supports the same scalar deal columns deal_field_changed can trigger on. Custom
  // fields ("custom_field:<key>") are out of scope for this action until a real use case
  // justifies the extra jsonb-merge path (documented in the spec's Non-goals).
  const ALLOWED: Record<string, string> = { title: "title" };
  const column = ALLOWED[fieldKey];
  if (column === undefined) {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, `unsupported update_field key: ${fieldKey}`);
  }
  const [before] = await db.select({ title: deals.title }).from(deals).where(eq(deals.id, deal.id));
  if (before === undefined) {
    return failed(ERROR_IDS.DEAL_NOT_FOUND, "deal no longer exists");
  }
  // Deliberately does NOT call updateDeal(): that function's own trailing evaluateAutomations
  // calls would let this same rule (or another watching the same field) re-fire for every
  // execution, since nothing here changes what triggered this run. Recursion is prevented by
  // construction (this path never calls evaluateAutomations at all) rather than by a
  // skip-automations flag threaded through updateDeal()'s signature, keeping the change
  // confined to this file. recordChange + publishBoardEvent are still called directly (not via
  // updateDeal) so the field change gets the same deal-history entry and live board update a
  // normal user edit would get; writing the column with neither would leave the UI showing a
  // stale title until a manual refresh.
  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({ title: String(value) })
      .where(eq(deals.id, deal.id));
    await recordChange(
      tx,
      {
        entityType: "deal",
        entityId: deal.id,
        field: fieldKey,
        oldValue: before.title,
        newValue: value,
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
  return ok({ fieldKey, value });
}

export async function runAction(
  db: Db,
  deal: DealRef,
  action: AutomationRuleAction,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  const config = action.actionConfig as Record<string, unknown>;
  switch (action.actionType) {
    case "create_activity":
      return runCreateActivity(db, deal, config, signal);
    case "send_notification":
      return runSendNotification(db, deal, config, signal);
    case "send_email":
      return runSendEmail(db, deal, config, signal);
    case "update_field":
      return runUpdateField(db, deal, config, signal);
  }
}
