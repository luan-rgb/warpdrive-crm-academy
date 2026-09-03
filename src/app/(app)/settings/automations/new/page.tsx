import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../../SettingsHeading";
import { SettingsPage } from "../../SettingsSurface";
import { AutomationWizard } from "../AutomationWizard";

export default async function NewAutomationPage(): Promise<ReactNode> {
  const { actor } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  return (
    <SettingsPage>
      <SettingsHeading title="New automation" />
      <AutomationWizard initialRule={null} />
    </SettingsPage>
  );
}
