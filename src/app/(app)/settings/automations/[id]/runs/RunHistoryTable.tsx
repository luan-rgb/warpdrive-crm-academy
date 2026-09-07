"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { AutomationRun } from "@/db/schema/automations";
import {
  runActionStatusPresentation,
  runStatusPresentation,
} from "@/features/automations/runHistoryStatus";
import { trpc } from "@/lib/trpc-client";

const TONE_TO_BADGE_VARIANT = {
  success: "success",
  error: "destructive",
  warning: "secondary",
} as const;

function formatStartedAt(date: Date): string {
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Radix's Collapsible primitive renders its own wrapping element for both trigger and content,
// which cannot stand in for a <tr> without breaking table semantics. A row disclosure is not one
// of the interactive surfaces the design system's hard rule enumerates (menu/dialog/native form
// controls), so a plain toggle button with aria-expanded is used here instead.
function RunActionsDetail({ runId }: { runId: string }): React.ReactNode {
  const { data: actions, isLoading } = trpc.automations.listActionsForRun.useQuery({ runId });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading actions…</p>;
  }
  if (actions === undefined || actions.length === 0) {
    return <p className="text-sm text-muted-foreground">No per-action detail recorded.</p>;
  }
  return (
    <ul className="space-y-1">
      {actions.map((action) => {
        const presentation = runActionStatusPresentation(action.status);
        return (
          <li key={action.id} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <Badge variant={TONE_TO_BADGE_VARIANT[presentation.tone]}>{presentation.label}</Badge>
              <span>{action.actionType}</span>
            </span>
            {action.status === "error" && action.errorMessage !== null && (
              <span className="text-sm text-destructive">{action.errorMessage}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RunHistoryRow({ run }: { run: AutomationRun }): React.ReactNode {
  const [open, setOpen] = useState(false);
  const presentation = runStatusPresentation(run.status);

  return (
    <>
      <tr className="border-t align-top">
        <td className="py-2 text-muted-foreground">{formatStartedAt(run.startedAt)}</td>
        <td className="py-2">
          <Link href={`/deals/${run.dealId}`} className="underline">
            View deal
          </Link>
        </td>
        <td className="py-2">
          <Badge variant={TONE_TO_BADGE_VARIANT[presentation.tone]}>{presentation.label}</Badge>
          {run.status !== "success" && run.errorMessage !== null && (
            <p className="mt-1 text-sm text-destructive">{run.errorMessage}</p>
          )}
        </td>
        <td className="py-2 text-right">
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide actions" : "View actions"}
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="pb-3">
            <RunActionsDetail runId={run.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export function RunHistoryTable({ runs }: { runs: AutomationRun[] }): React.ReactNode {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet for this automation.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2">Started</th>
          <th className="py-2">Deal</th>
          <th className="py-2">Status</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <RunHistoryRow key={run.id} run={run} />
        ))}
      </tbody>
    </table>
  );
}
