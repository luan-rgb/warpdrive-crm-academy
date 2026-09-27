import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { enqueueAutomationRuns, matchAutomationRules } from "./evaluate";

// Fire the activity triggers for an activity a PERSON created or completed (server actions and
// the MCP tools call this; the automation runner's own create_activity does not, so a rule that
// creates an activity can never trigger itself). Runs target the activity's deal; an activity
// with no deal has nothing for the rule to act on. Returns the fired rule ids.
export async function triggerActivityAutomations(
  db: Db,
  activity: { dealId: string | null },
  trigger: "activity_created" | "activity_completed",
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  if (activity.dealId === null) return [];
  const [deal] = await db.select().from(deals).where(eq(deals.id, activity.dealId));
  if (deal === undefined) return [];
  const matched = await matchAutomationRules(db, trigger, deal, deal, signal);
  await enqueueAutomationRuns(matched, deal.id, trigger, signal);
  return matched.map((r) => r.id);
}
