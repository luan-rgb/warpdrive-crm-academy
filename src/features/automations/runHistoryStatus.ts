import type { AutomationRunActionStatus, AutomationRunStatus } from "@/db/schema/automations";

export interface RunStatusPresentation {
  label: string;
  tone: "success" | "error" | "warning";
}

// Centralizes status -> badge mapping so the run list (single source of truth per run) and the
// per-action detail (same statuses, different table) never drift from each other.
export function runStatusPresentation(status: AutomationRunStatus): RunStatusPresentation {
  switch (status) {
    case "success":
      return { label: "Success", tone: "success" };
    case "error":
      return { label: "Failed", tone: "error" };
    case "partial":
      return { label: "Partial", tone: "warning" };
  }
}

export function runActionStatusPresentation(
  status: AutomationRunActionStatus,
): RunStatusPresentation {
  switch (status) {
    case "success":
      return { label: "Succeeded", tone: "success" };
    case "error":
      return { label: "Failed", tone: "error" };
    case "skipped":
      return { label: "Skipped", tone: "warning" };
  }
}
