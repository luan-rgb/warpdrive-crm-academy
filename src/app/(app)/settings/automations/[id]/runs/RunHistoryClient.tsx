"use client";

import type { AutomationRun } from "@/db/schema/automations";
import { RunHistoryTable } from "./RunHistoryTable";

export function RunHistoryClient({
  initialRuns,
}: {
  initialRuns: AutomationRun[];
}): React.ReactNode {
  return <RunHistoryTable runs={initialRuns} />;
}
