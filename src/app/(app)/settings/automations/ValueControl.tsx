"use client";
import type React from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DEAL_STATUS_OPTIONS } from "./automationLabels";
import type { WizardRefs } from "./wizardTypes";

// The input for one deal field's value, shared by conditions and the update-field action: a picker
// for references (stage, owner, status), a date input for dates, free text otherwise.
export function ValueControl({
  field,
  value,
  onChange,
  ariaLabel,
  refs,
}: {
  field: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  refs: WizardRefs;
}): React.ReactNode {
  if (field === "stageId" || field === "ownerId" || field === "status") {
    const options =
      field === "stageId" ? refs.stages : field === "ownerId" ? refs.users : DEAL_STATUS_OPTIONS;
    return <Select ariaLabel={ariaLabel} value={value} onChange={onChange} options={options} />;
  }
  return (
    <Input
      aria-label={ariaLabel}
      type={field === "expectedCloseDate" ? "date" : "text"}
      inputMode={field === "value" ? "decimal" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
