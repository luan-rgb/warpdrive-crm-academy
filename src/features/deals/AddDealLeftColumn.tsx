"use client";
import type React from "react";
import { useId } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { TITLE_MAX_LEN } from "@/constants/fieldLimits";
import { SOURCE_CHANNEL_KEYS, SOURCE_CHANNELS } from "@/constants/sourceChannels";
import { EntityCombobox } from "@/features/entity-create/EntityCombobox";
import { LabelField } from "@/features/labels/LabelField";
import { formatMediumDate } from "@/lib/formatDate";
import type { AddDealState } from "./addDealState";
import { StageChevron } from "./StageChevron";

const NO_CHANNEL_LABEL = "Nenhum canal";
const DEFAULT_VISIBILITY_LABEL = "Padrão";

interface Option {
  id: string;
  name: string;
}
interface PipelineOption extends Option {
  stages: Option[];
}

interface AddDealLeftColumnProps {
  state: AddDealState;
  set: (patch: Partial<AddDealState>) => void;
  // Title edits go through this (not set) so the modal can stop autofilling once the user types.
  // Optional: falls back to a plain title patch when a caller does not need the edit signal.
  onTitleChange?: (value: string) => void;
  people: Option[];
  orgs: Option[];
  pipelines: PipelineOption[];
  stages: Option[]; // stages of the currently selected pipeline
  owners: Option[] | null; // null hides the owner select (actor cannot reassign)
  groups: Option[] | null; // null hides the visible-to select
  baseCurrency: string;
  organizationCustomFields?: React.ReactNode;
  dealCustomFields?: React.ReactNode;
}

// Left column of the Add deal dialog (Pipedrive field order): contact/org, title, value, pipeline,
// stage, label, close date, owner, source, visibility. Purely presentational.
export function AddDealLeftColumn(props: AddDealLeftColumnProps): React.ReactNode {
  const {
    state,
    set,
    onTitleChange,
    people,
    orgs,
    pipelines,
    stages,
    owners,
    groups,
    baseCurrency,
    organizationCustomFields,
    dealCustomFields,
  } = props;
  const titleId = useId();
  const sourceChannelIdId = useId();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <EntityCombobox
        label="Pessoa de contato"
        options={people}
        placeholder="Buscar ou adicionar uma pessoa"
        createLabel={(q) => `Adicionar '${q}' como nova pessoa`}
        similarWarning="Já existe um contato semelhante."
        onSelectExisting={(id) => set({ personMode: "existing", personId: id })}
        onCreateNew={(name) => set({ personMode: "new", personId: "", newPersonName: name })}
        onClear={() => set({ personMode: "existing", personId: "", newPersonName: "" })}
      />

      <EntityCombobox
        label="Organização"
        options={orgs}
        placeholder="Buscar ou adicionar uma organização"
        createLabel={(q) => `Adicionar '${q}' como nova organização`}
        similarWarning="Já existe uma organização semelhante."
        onSelectExisting={(id) => set({ orgMode: "existing", orgId: id })}
        onCreateNew={(name) => set({ orgMode: "new", orgId: "", newOrgName: name })}
        onClear={() => set({ orgMode: "existing", orgId: "", newOrgName: "" })}
      />

      {state.orgMode === "new" ? organizationCustomFields : null}

      <label className="block" htmlFor={titleId}>
        <span className="mb-1 block font-medium">Título</span>
        <Input
          id={titleId}
          aria-label="Título do negócio"
          value={state.title}
          onChange={(e) =>
            onTitleChange ? onTitleChange(e.target.value) : set({ title: e.target.value })
          }
          placeholder="Título do negócio"
          maxLength={TITLE_MAX_LEN}
        />
        <span className="mt-0.5 block text-right text-xs tabular-nums text-muted-foreground">
          {state.title.length}/{TITLE_MAX_LEN}
        </span>
      </label>

      <div>
        <span className="mb-1 block font-medium">Valor</span>
        <div className="flex gap-2">
          <Input
            aria-label="Valor do negócio"
            inputMode="decimal"
            value={state.value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="0"
          />
          <span className="flex items-center rounded-md border bg-muted px-2.5 text-sm text-muted-foreground">
            {baseCurrency}
          </span>
        </div>
      </div>

      <div>
        <span className="mb-1 block font-medium">Pipeline</span>
        <Select
          ariaLabel="Pipeline"
          value={state.pipelineId}
          onChange={(v) => {
            const next = pipelines.find((p) => p.id === v);
            set({ pipelineId: v, stageId: next?.stages[0]?.id ?? "" });
          }}
          options={pipelines.map<SelectOption>((p) => ({ value: p.id, label: p.name }))}
        />
      </div>

      <div>
        <span className="mb-1 block font-medium">Etapa do pipeline</span>
        <StageChevron
          stages={stages}
          selectedId={state.stageId}
          onSelect={(id) => set({ stageId: id })}
        />
      </div>

      <div className="block">
        <span className="mb-1 block font-medium">Etiquetas</span>
        <LabelField target="deal" value={state.labels} onChange={(labels) => set({ labels })} />
      </div>

      <div className="block">
        <span className="mb-1 block font-medium">Data prevista de fechamento</span>
        <DatePicker
          ariaLabel="Data prevista de fechamento"
          value={state.expectedCloseDate === "" ? null : state.expectedCloseDate}
          placeholder="Definir data"
          triggerClassName="flex h-8 w-full items-center rounded border border-field-border bg-card px-2 text-left text-sm"
          formatLabel={formatMediumDate}
          onChange={(v) => set({ expectedCloseDate: v ?? "" })}
        />
      </div>

      {owners !== null && (
        <div className="block">
          <span className="mb-1 block font-medium">Responsável</span>
          <Combobox
            ariaLabel="Responsável"
            value={state.ownerId}
            onChange={(id) => set({ ownerId: id })}
            options={[
              { value: "", label: "Eu" },
              ...owners.map<ComboboxOption>((u) => ({
                value: u.id,
                label: u.name,
                avatarName: u.name,
              })),
            ]}
          />
        </div>
      )}

      <div>
        <span className="mb-1 block font-medium">Canal de origem</span>
        <Select
          ariaLabel="Canal de origem"
          value={state.sourceChannel}
          onChange={(v) => set({ sourceChannel: v })}
          placeholder={NO_CHANNEL_LABEL}
          options={[
            { value: "", label: NO_CHANNEL_LABEL },
            ...SOURCE_CHANNEL_KEYS.map<SelectOption>((k) => ({
              value: k,
              label: SOURCE_CHANNELS[k].name,
            })),
          ]}
        />
      </div>

      <label className="block" htmlFor={sourceChannelIdId}>
        <span className="mb-1 block font-medium">ID do canal de origem</span>
        <Input
          id={sourceChannelIdId}
          aria-label="ID do canal de origem"
          value={state.sourceChannelId}
          onChange={(e) => set({ sourceChannelId: e.target.value })}
          placeholder="ID de referência / campanha"
        />
      </label>

      {groups !== null && (
        <div className="block">
          <span className="mb-1 block font-medium">Visível para</span>
          <Select
            ariaLabel="Visível para"
            value={state.visibilityGroupId}
            onChange={(v) => set({ visibilityGroupId: v })}
            placeholder={DEFAULT_VISIBILITY_LABEL}
            options={[
              { value: "", label: DEFAULT_VISIBILITY_LABEL },
              ...groups.map<SelectOption>((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </div>
      )}

      {dealCustomFields}
    </div>
  );
}
