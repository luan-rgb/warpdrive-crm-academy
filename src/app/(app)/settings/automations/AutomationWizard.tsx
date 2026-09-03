"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGERS,
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
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";

const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_created: "Deal created",
  deal_stage_changed: "Deal stage changed",
  deal_status_changed: "Deal won or lost",
  deal_field_changed: "Deal field changed",
};

const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_activity: "Create activity",
  send_notification: "Send notification",
  send_email: "Send email",
  update_field: "Update field",
};

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
  const pipelines = pipelinesQuery.data ?? [];
  const activityTypes = activityTypesQuery.data ?? [];

  const [name, setName] = useState(initialRule?.rule.name ?? "");
  const [description, setDescription] = useState(initialRule?.rule.description ?? "");
  const [pipelineId, setPipelineId] = useState(initialRule?.rule.pipelineId ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initialRule?.rule.trigger ?? "deal_created",
  );
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    (initialRule?.rule.triggerConfig ?? {}) as Record<string, unknown>,
  );
  const [isActive, setIsActive] = useState(initialRule?.rule.isActive ?? true);
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
          ? "Add at least one action before saving."
          : "Could not save the automation.",
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
        setError("Automation saved, but the active toggle could not be updated.");
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
        <h3 className="text-sm font-medium">Trigger</h3>
        <Select
          ariaLabel="Trigger"
          value={trigger}
          onChange={(v) => {
            setTrigger(v as AutomationTrigger);
            setTriggerConfig({});
          }}
          options={AUTOMATION_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABEL[t] }))}
        />
        {trigger === "deal_status_changed" && (
          <Select
            ariaLabel="Status"
            value={(triggerConfig.toStatus ?? "") as string}
            onChange={(v) => setTriggerConfig({ toStatus: v })}
            options={[
              { value: "won", label: "Won" },
              { value: "lost", label: "Lost" },
            ]}
          />
        )}
        {trigger === "deal_field_changed" && (
          <Input
            aria-label="Field key"
            placeholder="e.g. title"
            value={(triggerConfig.fieldKey ?? "") as string}
            onChange={(e) => setTriggerConfig({ fieldKey: e.target.value })}
          />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Pipeline</h3>
        <Select
          ariaLabel="Pipeline"
          value={pipelineId}
          onChange={setPipelineId}
          options={[
            { value: "", label: "All pipelines" },
            ...pipelines.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Actions</h3>
        {actions.map((action, i) => (
          <div key={action.key} className="rounded border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{ACTION_LABEL[action.actionType]}</span>
              <Button variant="ghost" onClick={() => removeAction(i)}>
                Remove
              </Button>
            </div>
            {action.actionType === "create_activity" && (
              <>
                <Select
                  ariaLabel="Activity type"
                  value={(action.config.activityTypeId ?? "") as string}
                  onChange={(v) => updateActionConfig(i, { ...action.config, activityTypeId: v })}
                  options={activityTypes.map((t) => ({ value: t.id, label: t.name }))}
                />
                <Input
                  aria-label="Subject"
                  placeholder="Subject"
                  value={(action.config.subject ?? "") as string}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, subject: e.target.value })
                  }
                />
              </>
            )}
            {action.actionType === "send_notification" && (
              <Textarea
                aria-label="Notification message"
                placeholder="Message (use {{deal.title}}, {{deal.value}}, {{deal.owner}})"
                value={(action.config.messageTemplate ?? "") as string}
                onChange={(e) =>
                  updateActionConfig(i, { ...action.config, messageTemplate: e.target.value })
                }
              />
            )}
            {action.actionType === "send_email" && (
              <>
                <Input
                  aria-label="Email subject"
                  placeholder="Subject"
                  value={(action.config.subjectTemplate ?? "") as string}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, subjectTemplate: e.target.value })
                  }
                />
                <Textarea
                  aria-label="Email body"
                  placeholder="Body"
                  value={(action.config.bodyTemplate ?? "") as string}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, bodyTemplate: e.target.value })
                  }
                />
              </>
            )}
            {action.actionType === "update_field" && (
              <>
                <Input
                  aria-label="Field key"
                  placeholder="title"
                  value={(action.config.fieldKey ?? "") as string}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, fieldKey: e.target.value })
                  }
                />
                <Input
                  aria-label="New value"
                  placeholder="Value"
                  value={(action.config.value ?? "") as string}
                  onChange={(e) =>
                    updateActionConfig(i, { ...action.config, value: e.target.value })
                  }
                />
              </>
            )}
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
        <h3 className="text-sm font-medium">Name</h3>
        <Input
          aria-label="Automation name"
          placeholder="Name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          aria-label="Description"
          placeholder="Description (optional)"
          maxLength={200}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Switch checked={isActive} onCheckedChange={setIsActive} label="Active" />
      </div>

      <Button onClick={() => void save()} disabled={pending || name.trim() === ""}>
        Save
      </Button>
    </div>
  );
}
