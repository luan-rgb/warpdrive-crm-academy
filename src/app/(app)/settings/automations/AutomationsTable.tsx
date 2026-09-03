"use client";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import type { AutomationRule } from "@/db/schema/automations";

const TRIGGER_LABEL: Record<string, string> = {
  deal_created: "Deal created",
  deal_stage_changed: "Deal stage changed",
  deal_status_changed: "Deal won or lost",
  deal_field_changed: "Deal field changed",
};

export function AutomationsTable({
  rules,
  onToggle,
  onEdit,
  onDelete,
}: {
  rules: AutomationRule[];
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}): React.ReactNode {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">No automations yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2">Name</th>
          <th className="py-2">Trigger</th>
          <th className="py-2">Active</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id} className="border-t">
            <td className="py-2 font-medium">{rule.name}</td>
            <td className="py-2 text-muted-foreground">{TRIGGER_LABEL[rule.trigger]}</td>
            <td className="py-2">
              <Switch
                checked={rule.isActive}
                onCheckedChange={(v) => onToggle(rule.id, v)}
                label={`${rule.name} active`}
              />
            </td>
            <td className="py-2 text-right">
              <Button variant="ghost" onClick={() => onEdit(rule.id)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => onDelete(rule.id)}>
                Delete
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
