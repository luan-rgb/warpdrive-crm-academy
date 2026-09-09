"use client";
import type React from "react";

// Threads link to person_id (and deal_id), never to an organization, so an org has no linked
// mail to list. State the honest reason instead of a fake placeholder.
const ORG_NOT_APPLICABLE = "O e-mail é rastreado em pessoas, não em organizações.";

export function OrgEmailPanel(): React.ReactNode {
  return <p className="text-sm text-muted-foreground">{ORG_NOT_APPLICABLE}</p>;
}
