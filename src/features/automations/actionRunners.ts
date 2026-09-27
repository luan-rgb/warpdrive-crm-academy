import { and, eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { AutomationRuleAction } from "@/db/schema/automations";
import { deals } from "@/db/schema/deals";
import { emailAccounts } from "@/db/schema/email";
import { users } from "@/db/schema/identity";
import { persons } from "@/db/schema/persons";
import { createActivity } from "@/features/activities/repo";
import { createNote } from "@/features/collaboration/notesRepo";
import { sendGmail } from "@/features/email/sendSystem";
import { toPermSetUser } from "@/features/mcp/actorContext";
import { enqueueEmailNotification } from "@/features/notifications/emailDispatch";
import { createNotification } from "@/features/notifications/produce";
import { hydrateActor } from "@/server/hydrateActor";
import { type ActionOutcome, type DealRef, failed, succeeded as ok } from "./actionOutcome";
import { renderTemplate } from "./template";
import { runUpdateField } from "./updateFieldRunner";
import { defaultWebhookDeps, runWebhook } from "./webhookRunner";

export type { ActionOutcome, DealRef } from "./actionOutcome";

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
    return failed(
      ERROR_IDS.AUTOMATION_NOT_FOUND,
      "o responsável pelo negócio não existe ou está inativo",
    );
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
    return failed(ERROR_IDS.DEAL_NOT_FOUND, "o negócio não existe mais");
  }
  const message = renderTemplate(
    typeof config.messageTemplate === "string" ? config.messageTemplate : "",
    ctx,
  );
  const recipientId =
    typeof config.recipientId === "string" && config.recipientId !== ""
      ? config.recipientId
      : deal.ownerId;
  const result = await createNotification(
    db,
    {
      recipientId,
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
  // Same path as every other notification: the e-mail copy follows the recipient's preferences.
  await enqueueEmailNotification(
    db,
    result.value.notificationId,
    recipientId,
    "automation",
    signal,
  );
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
    .where(and(eq(emailAccounts.userId, deal.ownerId), eq(emailAccounts.status, "connected")));
  if (account === undefined) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_ACCOUNT_MISSING,
      "o responsável pelo negócio não tem uma caixa de e-mail conectada",
    );
  }
  const ctx = await loadDealTemplateContext(db, deal, signal);
  if (ctx === null) {
    return failed(ERROR_IDS.DEAL_NOT_FOUND, "o negócio não existe mais");
  }
  if (ctx.personId === null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "o negócio não tem uma pessoa de contato para receber o e-mail",
    );
  }
  const [person] = await db
    .select({ primaryEmail: persons.primaryEmail })
    .from(persons)
    .where(eq(persons.id, ctx.personId));
  if (person?.primaryEmail == null) {
    return failed(
      ERROR_IDS.AUTOMATION_EMAIL_RECIPIENT_MISSING,
      "a pessoa de contato não tem e-mail principal",
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

async function runAddNote(
  db: Db,
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  const actor = await hydrateActor(db, deal.ownerId, signal);
  if (actor === null) {
    return failed(
      ERROR_IDS.AUTOMATION_NOT_FOUND,
      "o responsável pelo negócio não existe ou está inativo",
    );
  }
  const ctx = await loadDealTemplateContext(db, deal, signal);
  if (ctx === null) return failed(ERROR_IDS.DEAL_NOT_FOUND, "o negócio não existe mais");
  const body = renderTemplate(
    typeof config.contentTemplate === "string" ? config.contentTemplate : "",
    ctx,
  ).trim();
  if (body === "") return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "a anotação está vazia");
  const result = await createNote(
    db,
    actor,
    { entityType: "deal", entityId: deal.id, body, pinned: false },
    signal,
  );
  if (!result.ok) return failed(result.error.id, result.error.message);
  return ok({ noteId: result.value.id });
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
    case "add_note":
      return runAddNote(db, deal, config, signal);
    case "webhook":
      return runWebhook(deal, config, signal, defaultWebhookDeps(db));
  }
}
