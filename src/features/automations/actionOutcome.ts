import type { AutomationRunActionStatus } from "@/db/schema/automations";

export interface ActionOutcome {
  status: AutomationRunActionStatus;
  // Shown in the rule's run history, so it is Portuguese; prefixed with the error id.
  errorMessage: string | null;
  resultSummary: Record<string, unknown> | null;
}

// The minimum a caller must know about a deal to run an action against it. Actions that need more
// (title, value, personId) re-read it from `id` rather than trusting the caller. A full deals row
// satisfies this shape structurally.
export interface DealRef {
  id: string;
  ownerId: string;
}

export function succeeded(resultSummary: Record<string, unknown>): ActionOutcome {
  return { status: "success", errorMessage: null, resultSummary };
}

export function failed(errorId: string, message: string): ActionOutcome {
  return { status: "error", errorMessage: `${errorId}: ${message}`, resultSummary: null };
}
