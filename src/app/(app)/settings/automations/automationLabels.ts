import type {
  AutomationActionType,
  AutomationRunActionStatus,
  AutomationRunStatus,
  AutomationTrigger,
} from "@/db/schema/automations";
import type { ConditionField } from "@/features/automations/conditions";

// Copy for the automation settings screens (wizard and run history).
export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  deal_created: "Negócio criado",
  deal_stage_changed: "Etapa do negócio alterada",
  deal_status_changed: "Negócio ganho ou perdido",
  deal_field_changed: "Campo do negócio alterado",
  activity_created: "Atividade criada em um negócio",
  activity_completed: "Atividade concluída em um negócio",
};

export const ACTION_LABEL: Record<AutomationActionType, string> = {
  create_activity: "Criar atividade",
  send_notification: "Enviar notificação",
  send_email: "Enviar e-mail",
  update_field: "Atualizar campo",
  add_note: "Adicionar anotação",
  webhook: "Chamar webhook",
};

export const RUN_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  success: "Sucesso",
  error: "Erro",
  partial: "Parcial",
};

export const ACTION_STATUS_LABEL: Record<AutomationRunActionStatus, string> = {
  success: "ok",
  error: "erro",
  skipped: "ignorada",
};

export const CONDITION_FIELD_LABEL: Record<ConditionField, string> = {
  value: "Valor",
  stageId: "Etapa",
  ownerId: "Responsável",
  status: "Status",
  labels: "Etiqueta",
  title: "Título",
  expectedCloseDate: "Data prevista de fechamento",
};

export const DEAL_STATUS_OPTIONS = [
  { value: "open", label: "Aberto" },
  { value: "won", label: "Ganho" },
  { value: "lost", label: "Perdido" },
];

// Change-log field keys a "campo alterado" trigger can watch (src/constants/changeLogFields.ts).
export const WATCHABLE_FIELDS = [
  { value: "title", label: "Título" },
  { value: "value", label: "Valor" },
  { value: "expected_close_date", label: "Data prevista de fechamento" },
  { value: "person_id", label: "Pessoa vinculada" },
  { value: "org_id", label: "Organização vinculada" },
  { value: "source_channel_id", label: "Canal de origem" },
];

export const TEMPLATE_HINT =
  "Você pode usar {{deal.title}}, {{deal.value}} e {{deal.owner}} no texto.";
