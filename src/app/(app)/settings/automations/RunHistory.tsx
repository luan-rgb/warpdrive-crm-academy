"use client";

import Link from "next/link";
import { formatDateTimePtBr } from "@/lib/formatDate";
import { trpc } from "@/lib/trpc-client";
import {
  ACTION_LABEL,
  ACTION_STATUS_LABEL,
  RUN_STATUS_LABEL,
  TRIGGER_LABEL,
} from "./automationLabels";

// Recent executions of one rule, with each action's outcome so a failed step (no mailbox,
// webhook refused) is visible without digging through logs.
export function RunHistory({ ruleId }: { ruleId: string }): React.ReactNode {
  const runsQuery = trpc.automations.listRunsForRule.useQuery({ ruleId });
  if (runsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando execuções...</p>;
  }
  const runs = runsQuery.data ?? [];
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta automação ainda não foi executada.</p>;
  }
  return (
    <ul className="max-w-2xl space-y-3">
      {runs.map((run) => (
        <li key={run.id} className="space-y-1 rounded border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{RUN_STATUS_LABEL[run.status]}</span>
            <span className="text-muted-foreground">{TRIGGER_LABEL[run.trigger]}</span>
            <Link href={`/deals/${run.dealId}`} className="underline">
              {run.dealTitle ?? "Negócio removido"}
            </Link>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTimePtBr(new Date(run.startedAt))}
            </span>
          </div>
          <ul className="space-y-0.5 pl-3 text-xs">
            {run.actions.map((a) => (
              <li key={a.position}>
                {ACTION_LABEL[a.actionType]}: {ACTION_STATUS_LABEL[a.status]}
                {a.errorMessage !== null && (
                  <span className="text-destructive"> ({a.errorMessage})</span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
