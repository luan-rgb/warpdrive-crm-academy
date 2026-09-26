import Link from "next/link";
import type React from "react";
import { cn } from "@/lib/utils";

// List | Calendar view toggle for Activities, mirroring the deal list's toggle.
// Pipedrive's Activities is list-first with a calendar alternative.
export function ActivitiesToggle({ active }: { active: "list" | "calendar" }): React.ReactNode {
  const segment = "rounded-sm px-2.5 py-1 text-sm transition-colors";
  const on = "bg-accent text-accent-foreground font-medium";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div className="mb-3 inline-flex rounded-md border bg-card p-0.5">
      {active === "list" ? (
        <span className={cn(segment, on)} aria-current="page">
          Lista
        </span>
      ) : (
        <Link href="/activities/list" className={cn(segment, off)}>
          Lista
        </Link>
      )}
      {active === "calendar" ? (
        <span className={cn(segment, on)} aria-current="page">
          Calendário
        </span>
      ) : (
        <Link href="/activities/calendar" className={cn(segment, off)}>
          Calendário
        </Link>
      )}
    </div>
  );
}
