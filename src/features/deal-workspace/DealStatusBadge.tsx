import type React from "react";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import type { DealStatus } from "@/constants/dealStatus";

const STATUS_PRESENTATION: Record<
  DealStatus,
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  open: { label: "Aberto", variant: "secondary" },
  won: { label: "Ganho", variant: "success" },
  lost: { label: "Perdido", variant: "destructive" },
};

export function DealStatusBadge({ status }: { status: DealStatus }): React.ReactNode {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <Badge
      variant={presentation.variant}
      aria-label={`Status do negócio: ${presentation.label}`}
    >
      {presentation.label}
    </Badge>
  );
}
