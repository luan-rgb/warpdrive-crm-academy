import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { getAutomationRule } from "@/features/automations/rulesRepo";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { AutomationWizard } from "../AutomationWizard";

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
      <SettingsHeading title="Editar automação" />
      <AutomationWizard initialRule={result.value} />
    </SettingsPage>
  );
}
