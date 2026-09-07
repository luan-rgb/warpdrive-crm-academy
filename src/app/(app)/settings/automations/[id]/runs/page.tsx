import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { getAutomationRule, listRunsForRule } from "@/features/automations/rulesRepo";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../../SettingsHeading";
import { SettingsPage } from "../../../SettingsSurface";
import { RunHistoryClient } from "./RunHistoryClient";

export default async function AutomationRunHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  const { id } = await params;
  const ruleResult = await getAutomationRule(db, id, AbortSignal.timeout(5000));
  if (!ruleResult.ok) notFound();

  const runs = await listRunsForRule(db, id, AbortSignal.timeout(5000));

  return (
    <SettingsPage>
      <SettingsHeading title={`${ruleResult.value.rule.name}: run history`} />
      <RunHistoryClient initialRuns={runs} />
    </SettingsPage>
  );
}
