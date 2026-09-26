"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import type { HelpTopic } from "@/constants/helpTexts";
import {
  AUTOMATION_ACTION_TYPES,
  type AutomationActionType,
  type AutomationRule,
  type AutomationRuleAction,
  type AutomationTrigger,
} from "@/db/schema/automations";
import {
  createAutomationRuleAction,
  setAutomationRuleActiveAction,
  updateAutomationRuleAction,
} from "@/features/automations/actions";
import type { AutomationCondition } from "@/features/automations/conditions";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ActionEditor } from "./ActionEditor";
import { ACTION_LABEL } from "./automationLabels";
import { ConditionsEditor } from "./ConditionsEditor";
import { TriggerSection } from "./TriggerSection";
import type { WizardOption, WizardRefs } from "./wizardTypes";

function SectionTitle({ children, help }: { children: string; help: HelpTopic }): React.ReactNode {
  return (
    <div className="flex items-center gap-1">
      <h3 className="text-sm font-medium">{children}</h3>
      <HelpTooltip topic={help} />
    </div>
  );
}

interface DraftAction {
  // Stable client-only id (not persisted) so list rendering never keys off array index, which
  // would misattribute focus/state across a remove-then-reorder.
  key: string;
  actionType: AutomationActionType;
  config: Record<string, unknown>;
}

export function AutomationWizard({
  initialRule,
}: {
  initialRule: { rule: AutomationRule; actions: AutomationRuleAction[] } | null;
}): React.ReactNode {
  const router = useRouter();
  // Real tRPC procedure names, confirmed against the mounted routers (Task 8 pre-flight
  // question): pipelines live under the top-level "pipeline" router (pipelineRouter.ts's
  // `list` procedure), and activity types are `activities.listTypes` (activities/router.ts),
  // not the `pipelines.list` / `activityTypes.list` names the plan guessed.
  const pipelinesQuery = trpc.pipeline.list.useQuery();
  const activityTypesQuery = trpc.activities.listTypes.useQuery();
  const usersQuery = trpc.identity.assignableUsers.useQuery();
  const pipelines = pipelinesQuery.data ?? [];

  const [name, setName] = useState(initialRule?.rule.name ?? "");
  const [description, setDescription] = useState(initialRule?.rule.description ?? "");
  const [pipelineId, setPipelineId] = useState(initialRule?.rule.pipelineId ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initialRule?.rule.trigger ?? "deal_created",
  );
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    (initialRule?.rule.triggerConfig ?? {}) as Record<string, unknown>,
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    (initialRule?.rule.conditions ?? []) as AutomationCondition[],
  );
  const [isActive, setIsActive] = useState(initialRule?.rule.isActive ?? true);

  // Stages of the chosen pipeline, or of every pipeline (named "Funil / Etapa") when the rule
  // applies to all of them.
  const stages: WizardOption[] = pipelines
    .filter((p) => pipelineId === "" || p.id === pipelineId)
    .flatMap((p) =>
      p.stages.map((st) => ({
        value: st.id,
        label: pipelineId === "" ? `${p.name} / ${st.name}` : st.name,
      })),
    );
  const refs: WizardRefs = {
    stages,
    users: (usersQuery.data ?? []).map((u) => ({ value: u.id, label: u.name })),
    activityTypes: (activityTypesQuery.data ?? []).map((t) => ({ value: t.id, label: t.name })),
  };
  const [actions, setActions] = useState<DraftAction[]>(
    initialRule?.actions.map((a) => ({
      key: a.id,
      actionType: a.actionType,
      config: a.actionConfig as Record<string, unknown>,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addAction(actionType: AutomationActionType): void {
    setActions((prev) => [...prev, { key: crypto.randomUUID(), actionType, config: {} }]);
  }

  function updateActionConfig(index: number, config: Record<string, unknown>): void {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, config } : a)));
  }

  function removeAction(index: number): void {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(): Promise<void> {
    setError(null);
    setPending(true);
    const payload = {
      name,
      description: description.trim() === "" ? null : description,
      pipelineId: pipelineId === "" ? null : pipelineId,
      trigger,
      triggerConfig,
      conditions,
      actions: actions.map((a) => ({ actionType: a.actionType, config: a.config })),
    };
    const r =
      initialRule === null
        ? await createAutomationRuleAction({ ...payload, isActive }, readCsrfToken())
        : await updateAutomationRuleAction(
            { ...payload, id: initialRule.rule.id },
            readCsrfToken(),
          );
    if (!r.ok) {
      setPending(false);
      setError(
        r.error.id === "E_AUTOMATION_003"
          ? "Adicione ao menos uma ação antes de salvar."
          : r.error.id === "E_AUTOMATION_001"
            ? "Confira os campos: há uma condição ou ação incompleta."
            : "Não foi possível salvar a automação.",
      );
      return;
    }
    // updateAutomationRuleInputSchema has no isActive field (Task 2) so the edit wizard's
    // Active switch would otherwise silently discard its value on save (toggling active status
    // is normally Task 7's table switch, calling setAutomationRuleActiveAction directly). Only
    // fire this second call when editing AND the switch actually changed, so a create (which
    // already sent isActive above) and an unchanged edit don't take a redundant round trip.
    if (initialRule !== null && isActive !== initialRule.rule.isActive) {
      const activeResult = await setAutomationRuleActiveAction(
        { id: initialRule.rule.id, isActive },
        readCsrfToken(),
      );
      setPending(false);
      if (!activeResult.ok) {
        setError("Automação salva, mas não foi possível atualizar o status ativo.");
        return;
      }
    } else {
      setPending(false);
    }
    router.push("/settings/automations");
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <SectionTitle help="automation.trigger">Quando</SectionTitle>
        <TriggerSection
          trigger={trigger}
          triggerConfig={triggerConfig}
          onTrigger={(t) => {
            setTrigger(t);
            setTriggerConfig({});
          }}
          onConfig={setTriggerConfig}
          stages={stages}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Funil</h3>
        <Select
          ariaLabel="Funil"
          value={pipelineId}
          onChange={setPipelineId}
          options={[
            { value: "", label: "Todos os funis" },
            ...pipelines.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>

      <div className="space-y-2">
        <SectionTitle help="automation.conditions">Só executar se</SectionTitle>
        <ConditionsEditor conditions={conditions} onChange={setConditions} refs={refs} />
      </div>

      <div className="space-y-2">
        <SectionTitle help="automation.actions">Então</SectionTitle>
        {actions.map((action, i) => (
          <div key={action.key} className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{ACTION_LABEL[action.actionType]}</span>
              <Button variant="ghost" onClick={() => removeAction(i)}>
                Remover
              </Button>
            </div>
            <ActionEditor
              actionType={action.actionType}
              config={action.config}
              onChange={(config) => updateActionConfig(i, config)}
              refs={refs}
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {AUTOMATION_ACTION_TYPES.map((t) => (
            <Button key={t} variant="ghost" onClick={() => addAction(t)}>
              + {ACTION_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Nome</h3>
        <Input
          aria-label="Nome da automação"
          placeholder="Nome"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          aria-label="Descrição"
          placeholder="Descrição (opcional)"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Switch checked={isActive} onCheckedChange={setIsActive} label="Ativa" />
      </div>

      <Button
        onClick={() => void save()}
        disabled={pending || name.trim() === "" || actions.length === 0}
      >
        Salvar
      </Button>
    </div>
  );
}
