# Phase 0 Research: Automation Execution History

No `NEEDS CLARIFICATION` markers exist in the Technical Context: this feature adds a read-only
view on top of an already-implemented backend inside an existing, single-stack project (Next.js
+ tRPC + Drizzle + Postgres + shadcn/ui), so there is no technology choice to research.

## Decision: reuse existing data, add one read procedure

- **Decision**: Serve the history view entirely from `automation_runs` (already queried by
  `listRunsForRule`) and `automation_run_actions` (not yet exposed via tRPC — add one new
  `listActionsForRun` query procedure).
- **Rationale**: Both tables were built and populated in Phase 1 specifically to support this
  follow-up view (see `docs/superpowers/reports/2026-09-02-automations-phase1-completion.md`,
  "Deliberately deferred" section). No new persistence is needed.
- **Alternatives considered**: Joining `automation_run_actions` directly into `listRunsForRule`
  (one round trip instead of two) was considered and rejected for this feature: it would fetch
  per-action detail for all 100 runs even though User Story 3 only needs it for a run the user
  actively opens, and the existing procedure's shape is already relied on by nothing else that
  would benefit from the join. A separate on-demand procedure keeps the default history list
  fast and matches the "expand for detail" interaction described in User Story 3.

## Decision: status presentation

- **Decision**: Map the three `automation_run_status` values (`success`, `error`, `partial`) and
  three `automation_run_action_status` values (`success`, `error`, `skipped`) to existing shadcn
  badge/tone conventions already used elsewhere in the settings UI, via one small pure function
  (`runHistoryStatus.ts`) rather than inline conditionals in the component.
- **Rationale**: Constitution's Code Organization principle keeps small, focused files; a pure
  mapping function is trivially unit-testable without a database, keeping the integration-test
  budget for the actual query.
- **Alternatives considered**: Inlining the status-to-badge logic directly in the table
  component. Rejected: harder to unit-test in isolation, and the same mapping is needed in two
  places (the run list and the run detail/action list).

## Known, out-of-scope limitation carried forward

The "Provisional run status" gap from the Phase 1 completion report (a run is marked `success`
before its actions finish, corrected after) is a data-layer limitation this feature does not
fix. It is called out in spec.md's Assumptions so it is not mistaken for a defect introduced by
this feature.
