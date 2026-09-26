"use client";
import { CircleHelp } from "lucide-react";
import type React from "react";
import { HELP_TEXTS, type HelpTopic } from "@/constants/helpTexts";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

// The "?" next to a feature, field or section: a click (or tap, or Enter) opens a short
// explanation from the central catalogue (src/constants/helpTexts.ts). Built on the Popover
// primitive rather than Tooltip because tooltips never open on touch screens and cannot hold a
// paragraph a student may want to read calmly.
export function HelpTooltip({
  topic,
  side = "bottom",
  className,
}: {
  topic: HelpTopic;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}): React.ReactNode {
  const help = HELP_TEXTS[topic];
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={`Ajuda: ${help.title}`}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side={side} className="max-w-xs p-3 text-sm">
        <p className="font-medium">{help.title}</p>
        <p className="mt-1 text-pretty text-muted-foreground">{help.body}</p>
      </PopoverContent>
    </Popover>
  );
}
