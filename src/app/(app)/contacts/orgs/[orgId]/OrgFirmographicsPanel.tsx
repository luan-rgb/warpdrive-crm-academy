"use client";
import type React from "react";
import { updateOrgAction } from "@/features/contacts/actions";
import { FieldRow } from "@/features/deal-workspace/sidebar/FieldRow";
import { InlineTextField } from "@/features/inline-edit/InlineTextField";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";

interface PanelOrg {
  id: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  linkedinUrl: string | null;
}

interface OrgFirmographicsPanelProps {
  org: PanelOrg;
  onSaved: () => void;
  // Hidden built-in field keys (settings > Data fields). A hidden firmographic row is not rendered.
  hidden?: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

type FirmographicPatch = Partial<{
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: string | null;
  linkedinUrl: string | null;
}>;

// Click-to-edit-in-place Details/Firmographics rows for the org detail aside, autosaving
// through updateOrgAction. Mirrors OrgSummaryEditPanel's inline-edit style; org has no CAS
// precondition (last-write-wins), so no expectedUpdatedAt is threaded through here either.
export function OrgFirmographicsPanel({
  org,
  onSaved,
  hidden = NONE,
}: OrgFirmographicsPanelProps): React.ReactNode {
  async function save(patch: FirmographicPatch): Promise<Result<unknown, string>> {
    const r = await updateOrgAction({ id: org.id, ...patch }, readCsrfToken());
    onSaved();
    return r.ok ? ok(r.value) : err(r.error.id);
  }

  function saveText(field: "domain" | "industry" | "linkedinUrl", v: string) {
    const trimmed = v.trim();
    return save({ [field]: trimmed === "" ? null : trimmed });
  }

  return (
    <>
      {!hidden.has("domain") && (
        <FieldRow label="Site" empty={org.domain === null || org.domain === ""}>
          <InlineTextField
            label="Site"
            value={org.domain ?? ""}
            onSave={(v) => saveText("domain", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("linkedinUrl") && (
        <FieldRow label="LinkedIn" empty={org.linkedinUrl === null || org.linkedinUrl === ""}>
          <InlineTextField
            label="LinkedIn"
            value={org.linkedinUrl ?? ""}
            onSave={(v) => saveText("linkedinUrl", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("industry") && (
        <FieldRow label="Setor" empty={org.industry === null || org.industry === ""}>
          <InlineTextField
            label="Setor"
            value={org.industry ?? ""}
            onSave={(v) => saveText("industry", v)}
          />
        </FieldRow>
      )}
      {!hidden.has("annualRevenue") && (
        <FieldRow
          label="Faturamento anual"
          empty={org.annualRevenue === null || org.annualRevenue === ""}
        >
          <InlineTextField
            label="Faturamento anual"
            value={org.annualRevenue ?? ""}
            placeholder="+ Adicionar faturamento"
            onSave={(v) => {
              const trimmed = v.trim();
              return save({ annualRevenue: trimmed === "" ? null : trimmed });
            }}
          />
        </FieldRow>
      )}
      {!hidden.has("employeeCount") && (
        <FieldRow label="Funcionários" empty={org.employeeCount == null}>
          <InlineTextField
            label="Funcionários"
            value={org.employeeCount == null ? "" : String(org.employeeCount)}
            placeholder="+ Adicionar funcionários"
            onSave={(v) => {
              const trimmed = v.trim();
              return save({ employeeCount: trimmed === "" ? null : Number(trimmed) });
            }}
          />
        </FieldRow>
      )}
    </>
  );
}
