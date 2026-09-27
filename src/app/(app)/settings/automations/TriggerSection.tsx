"use client";
import type React from "react";
import { Select } from "@/components/ui/Select";
import { AUTOMATION_TRIGGERS, type AutomationTrigger } from "@/db/schema/automations";
import { TRIGGER_LABEL, WATCHABLE_FIELDS } from "./automationLabels";
import type { WizardOption } from "./wizardTypes";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// The trigger picker and its per-trigger settings: a destination stage, a won/lost status or the
// field to watch, each chosen from a list instead of typed.
export function TriggerSection({
  trigger,
  triggerConfig,
  onTrigger,
  onConfig,
  stages,
}: {
  trigger: AutomationTrigger;
  triggerConfig: Record<string, unknown>;
  onTrigger: (t: AutomationTrigger) => void;
  onConfig: (c: Record<string, unknown>) => void;
  stages: WizardOption[];
}): React.ReactNode {
  return (
    <>
      <Select
        ariaLabel="Gatilho"
        value={trigger}
        onChange={(v) => onTrigger(v as AutomationTrigger)}
        options={AUTOMATION_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABEL[t] }))}
      />
      {trigger === "deal_stage_changed" && (
        <Select
          ariaLabel="Etapa de destino"
          value={str(triggerConfig.toStageId)}
          onChange={(v) => onConfig({ toStageId: v === "" ? null : v })}
          options={[{ value: "", label: "Qualquer etapa" }, ...stages]}
        />
      )}
      {trigger === "deal_status_changed" && (
        <Select
          ariaLabel="Status"
          value={str(triggerConfig.toStatus)}
          onChange={(v) => onConfig({ toStatus: v })}
          options={[
            { value: "won", label: "Ganho" },
            { value: "lost", label: "Perdido" },
          ]}
        />
      )}
      {trigger === "deal_field_changed" && (
        <Select
          ariaLabel="Campo alterado"
          value={str(triggerConfig.fieldKey)}
          onChange={(v) => onConfig({ fieldKey: v })}
          options={WATCHABLE_FIELDS}
          placeholder="Escolha o campo"
        />
      )}
    </>
  );
}
