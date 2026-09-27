"use client";
import type React from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { AutomationActionType } from "@/db/schema/automations";
import { AUTOMATION_UPDATE_FIELDS } from "@/features/automations/updateFields";
import { TEMPLATE_HINT } from "./automationLabels";
import { ValueControl } from "./ValueControl";
import type { WizardRefs } from "./wizardTypes";

type Config = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// The settings of one action, by type. Every control writes into the action's config object,
// validated by the server on save (features/automations/schemas.ts).
export function ActionEditor({
  actionType,
  config,
  onChange,
  refs,
}: {
  actionType: AutomationActionType;
  config: Config;
  onChange: (next: Config) => void;
  refs: WizardRefs;
}): React.ReactNode {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const hint = <p className="text-xs text-muted-foreground">{TEMPLATE_HINT}</p>;

  switch (actionType) {
    case "create_activity":
      return (
        <>
          <Select
            ariaLabel="Tipo de atividade"
            value={str(config.activityTypeId)}
            onChange={(v) => set("activityTypeId", v)}
            options={refs.activityTypes}
          />
          <Input
            aria-label="Assunto"
            placeholder="Assunto"
            value={str(config.subject)}
            onChange={(e) => set("subject", e.target.value)}
          />
        </>
      );
    case "send_notification":
      return (
        <>
          <Select
            ariaLabel="Quem recebe"
            value={str(config.recipientId)}
            onChange={(v) => set("recipientId", v)}
            options={[{ value: "", label: "Responsável pelo negócio" }, ...refs.users]}
          />
          <Textarea
            aria-label="Mensagem da notificação"
            placeholder="Mensagem"
            value={str(config.messageTemplate)}
            onChange={(e) => set("messageTemplate", e.target.value)}
          />
          {hint}
        </>
      );
    case "send_email":
      return (
        <>
          <Input
            aria-label="Assunto do e-mail"
            placeholder="Assunto"
            value={str(config.subjectTemplate)}
            onChange={(e) => set("subjectTemplate", e.target.value)}
          />
          <Textarea
            aria-label="Corpo do e-mail"
            placeholder="Corpo"
            value={str(config.bodyTemplate)}
            onChange={(e) => set("bodyTemplate", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Enviado da caixa do responsável para a pessoa de contato do negócio. {TEMPLATE_HINT}
          </p>
        </>
      );
    case "update_field": {
      const field = str(config.fieldKey);
      return (
        <>
          <Select
            ariaLabel="Campo a atualizar"
            value={field}
            onChange={(v) => onChange({ fieldKey: v, value: "" })}
            options={Object.entries(AUTOMATION_UPDATE_FIELDS).map(([value, f]) => ({
              value,
              label: f.label,
            }))}
          />
          {field !== "" ? (
            <ValueControl
              field={field}
              value={str(config.value)}
              onChange={(v) => set("value", v)}
              ariaLabel="Novo valor"
              refs={refs}
            />
          ) : null}
        </>
      );
    }
    case "add_note":
      return (
        <>
          <Textarea
            aria-label="Texto da anotação"
            placeholder="Anotação que será adicionada ao negócio"
            value={str(config.contentTemplate)}
            onChange={(e) => set("contentTemplate", e.target.value)}
          />
          {hint}
        </>
      );
    case "webhook":
      return (
        <>
          <Input
            aria-label="URL do webhook"
            type="url"
            placeholder="https://..."
            value={str(config.url)}
            onChange={(e) => set("url", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Envia os dados do negócio (JSON, método POST) para esse endereço. Serve para integrar
            com Zapier, Make, n8n ou um sistema seu.
          </p>
        </>
      );
  }
}
