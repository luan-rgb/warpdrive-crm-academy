"use client";

import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import type { AutomationRule } from "@/db/schema/automations";

const TRIGGER_LABEL: Record<string, string> = {
  deal_created: "Negócio criado",
  deal_stage_changed: "Etapa do negócio alterada",
  deal_status_changed: "Negócio ganho ou perdido",
  deal_field_changed: "Campo do negócio alterado",
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
    return <p className="text-sm text-muted-foreground">Ainda não há automações.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2">Nome</th>
          <th className="py-2">Gatilho</th>
          <th className="py-2">Ativa</th>
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
                Editar
              </Button>
              <Button variant="ghost" onClick={() => onDelete(rule.id)}>
                Excluir
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
