import Link from "next/link";
import type React from "react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import type { HelpTopic } from "@/constants/helpTexts";

export interface Crumb {
  label: string;
  // A parent crumb links somewhere; the current (last) crumb omits href and renders as plain text.
  href?: string;
}

// Shared page heading: a Pipedrive-style breadcrumb over a 25px page title. Centralizing the title
// size + breadcrumb here stops the per-page drift (bare 18-20px titles, no breadcrumb) the parity
// specs flagged across settings, contacts, leads, and inbox.
export function PageHeading({
  title,
  crumbs,
  description,
  actions,
  help,
}: {
  title: string;
  crumbs?: Crumb[];
  description?: React.ReactNode;
  actions?: React.ReactNode;
  // The "?" beside the title explaining what the page is for (src/constants/helpTexts.ts).
  help?: HelpTopic;
}): React.ReactNode {
  return (
    <div className="mb-4">
      {crumbs !== undefined && crumbs.length > 0 ? (
        <nav aria-label="Navegação estrutural" className="mb-1">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <li
                  key={`${crumb.label}-${crumb.href ?? "current"}`}
                  className="flex items-center gap-1"
                >
                  {i > 0 ? (
                    <span aria-hidden="true" className="text-muted-foreground/60">
                      /
                    </span>
                  ) : null}
                  {crumb.href !== undefined && !isLast ? (
                    <Link href={crumb.href} className="hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={isLast ? "page" : undefined} className="text-foreground">
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        {/* Inter is a vendored variable font, so the 450 weight (lighter than semibold) resolves. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="text-display font-[450] leading-tight tracking-tight">{title}</h1>
          {help !== undefined ? <HelpTooltip topic={help} /> : null}
        </div>
        {actions}
      </div>
      {description !== undefined ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
