import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { getAutomationRule } from "@/features/automations/rulesRepo";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { AutomationWizard } from "../AutomationWizard";
import { RunHistory } from "../RunHistory";

export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  const { id } = await params;
  const result = await getAutomationRule(db, id, AbortSignal.timeout(5000));
  if (!result.ok) notFound();

  return (
    <SettingsPage>
      <SettingsHeading help="automation.list" title="Editar automação" />
      <AutomationWizard initialRule={result.value} />
      <section className="mt-10 space-y-3">
        <div className="flex items-center gap-1">
          <h2 className="text-base font-semibold">Histórico de execuções</h2>
          <HelpTooltip topic="automation.history" />
        </div>
        <RunHistory ruleId={id} />
      </section>
    </SettingsPage>
  );
}
