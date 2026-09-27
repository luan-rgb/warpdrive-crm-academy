"use client";
import type React from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { FILTER_OP_LABELS, type FilterOpKey } from "@/constants/filterOps";
import {
  type AutomationCondition,
  CONDITION_OPS,
  type ConditionField,
} from "@/features/automations/conditions";
import { CONDITION_FIELD_LABEL } from "./automationLabels";
import { ValueControl } from "./ValueControl";
import type { WizardRefs } from "./wizardTypes";

const FIELDS = Object.keys(CONDITION_OPS) as ConditionField[];
const VALUELESS = new Set(["isEmpty", "isNotEmpty"]);

// A value condition almost always means "worth more than X", so a new row starts there.
function blank(field: ConditionField): AutomationCondition {
  const op = field === "value" ? "gt" : CONDITION_OPS[field][0];
  return { field, op, value: "" } as AutomationCondition;
}

// "Só executar se...": AND-joined conditions on the deal. Draft rows are loosely typed until the
// server validates them on save.
export function ConditionsEditor({
  conditions,
  onChange,
  refs,
}: {
  conditions: AutomationCondition[];
  onChange: (next: AutomationCondition[]) => void;
  refs: WizardRefs;
}): React.ReactNode {
  const patch = (i: number, next: Partial<AutomationCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? ({ ...c, ...next } as AutomationCondition) : c)));

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and edited in place
        <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2">
          <Select
            ariaLabel={`Campo da condição ${i + 1}`}
            value={c.field}
            onChange={(v) =>
              onChange(conditions.map((x, j) => (j === i ? blank(v as ConditionField) : x)))
            }
            options={FIELDS.map((f) => ({ value: f, label: CONDITION_FIELD_LABEL[f] }))}
          />
          <Select
            ariaLabel={`Operador da condição ${i + 1}`}
            value={c.op}
            onChange={(v) => patch(i, { op: v } as Partial<AutomationCondition>)}
            options={CONDITION_OPS[c.field].map((op) => ({
              value: op,
              label: FILTER_OP_LABELS[op as FilterOpKey],
            }))}
          />
          {VALUELESS.has(c.op) ? (
            <span />
          ) : (
            <ValueControl
              field={c.field}
              value={c.value}
              onChange={(v) => patch(i, { value: v })}
              ariaLabel={`Valor da condição ${i + 1}`}
              refs={refs}
            />
          )}
          <Button
            variant="ghost"
            aria-label={`Remover condição ${i + 1}`}
            onClick={() => onChange(conditions.filter((_, j) => j !== i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => onChange([...conditions, blank("value")])}>
        + Adicionar condição
      </Button>
    </div>
  );
}
