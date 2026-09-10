"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { AutomationRule } from "@/db/schema/automations";
import {
  deleteAutomationRuleAction,
  setAutomationRuleActiveAction,
} from "@/features/automations/actions";
import { readCsrfToken } from "@/utils/csrfCookie";
import { AutomationsTable } from "./AutomationsTable";

export function AutomationsClient({
  rules: initialRules,
}: {
  rules: AutomationRule[];
}): React.ReactNode {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    router.refresh();
  }

  async function toggle(id: string, isActive: boolean): Promise<void> {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, isActive } : r)));
    const r = await setAutomationRuleActiveAction({ id, isActive }, readCsrfToken());
    if (!r.ok) {
      setRules((prev) => prev.map((rr) => (rr.id === id ? { ...rr, isActive: !isActive } : rr)));
      setError("Could not update the automation.");
    }
  }

  async function confirmDelete(): Promise<void> {
    const id = pendingDelete;
    if (id === null) return;
    setPendingDelete(null);
    const r = await deleteAutomationRuleAction({ id }, readCsrfToken());
    if (r.ok) {
      setRules((prev) => prev.filter((rr) => rr.id !== id));
      refresh();
      return;
    }
    setError("Could not delete the automation.");
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AutomationsTable
        rules={rules}
        onToggle={(id, v) => void toggle(id, v)}
        onEdit={(id) => router.push(`/settings/automations/${id}`)}
        onDelete={(id) => setPendingDelete(id)}
      />
      <Button onClick={() => router.push("/settings/automations/new")}>+ Automação</Button>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir automação"
        description="Isso exclui permanentemente a regra de automação. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
