import type { ReactNode } from "react";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import { listAutomationRules } from "@/features/automations/rulesRepo";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { AutomationsClient } from "./AutomationsClient";

export const metadata = { title: SETTINGS_STRINGS.automations };

export default async function AutomationsSettingsPage(): Promise<ReactNode> {
  const { actor, db } = await createContext();
  if (actor === null || !can(actor, "automation.manage")) {
    return <p className="text-sm text-red-600">{SETTINGS_STRINGS.requiresAdmin}</p>;
  }
  const rules = await listAutomationRules(db, AbortSignal.timeout(5000));

  return (
    <SettingsPage>
      <SettingsHeading
        title={SETTINGS_STRINGS.automations}
        description={SETTINGS_STRINGS.automationsDescription}
      />
      <AutomationsClient rules={rules} />
    </SettingsPage>
  );
}
