# Implementation Plan: Automation Execution History

**Branch**: `001-automation-execution-history` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-automation-execution-history/spec.md`

## Summary

Give automation owners a read-only view of a rule's past executions (status, deal, timing,
failure reason, and per-action breakdown), reusing the run/run-action data the Phase 1
automations engine already persists. No new backend capability beyond one small tRPC query for
per-run action detail; the primary work is a new settings route and two presentational
components wired to `automationsRouter`.

## Technical Context

**Language/Version**: TypeScript, Next.js (App Router)

**Primary Dependencies**: tRPC + TanStack Query (reads), Drizzle ORM + Postgres, shadcn/ui +
Tailwind (existing `Button`, `Badge`/status-indicator primitives already in
`src/components/ui/`)

**Storage**: Postgres, existing tables `automation_runs` and `automation_run_actions` (no schema
change)

**Testing**: Vitest — `unit` project for pure UI logic (status label/formatting helpers) and
`integration` project (real Postgres) for the new tRPC procedure, per constitution Principle I

**Target Platform**: Web (existing warpdrive Next.js app, server-rendered settings pages)

**Project Type**: Web application (single Next.js app, no separate frontend/backend split)

**Performance Goals**: History list and per-run action detail each resolve in a single query
under the existing `AbortSignal.timeout(10_000)` convention used by the rest of
`automationsRouter`; no new performance target beyond matching sibling procedures.

**Constraints**: Must not add a new database migration (the required data already exists);
must not change `automation_runs`/`automation_run_actions` write paths (job.ts,
actionRunners.ts) — this feature is read-only.

**Scale/Scope**: One rule's history at a time, capped at the existing 100-run limit (FR/SC
already accept this as the retention boundary). No pagination beyond that cap is in scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Test-First | New tRPC procedure and UI status-mapping logic get failing tests first; integration test hits real Postgres, no DB mocking | PASS (planned in tasks) |
| II. Result Types Over Throws | The new procedure has no operational failure mode of its own (a run/rule that doesn't exist just returns an empty list, matching `listRunsForRule`'s existing behavior) — no new `Result` needed | PASS (no violation, nothing to wrap) |
| III. Validate at the Boundary | New procedure input (`runId: z.string().uuid()`) validated with Zod, same pattern as `listRunsForRule` | PASS |
| IV. Single Env Boundary | No new env vars | N/A |
| V. Stable Error Identity | No new failure mode introduced (read-only, empty-result-on-miss); no new `E_AUTOMATION_*` ID needed | PASS |
| VI. Cancellable Long Operations | New procedure takes `AbortSignal.timeout(10_000)` matching sibling procedures | PASS |
| Design System Discipline | Status badges, empty state, and the runs table are built from existing `src/components/ui/` primitives (`Badge`/equivalent, `Table` pattern already used by `AutomationsTable`) — no hand-rolled interactive controls | PASS |

No violations. Complexity Tracking section is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-automation-execution-history/
├── plan.md              # This file
├── research.md          # Phase 0 output (no unknowns — stack fixed by existing project)
├── data-model.md        # Phase 1 output (reuses existing entities, documents read shape)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (tRPC procedure contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── db/schema/automations.ts                          # unchanged (reused: automationRuns, automationRunActions)
├── features/automations/
│   ├── router.ts                                      # add listActionsForRun procedure
│   ├── router.test.ts                                 # new: integration test for the new procedure
│   └── runHistoryStatus.ts                             # new: pure status → label/tone mapping helper
│   └── runHistoryStatus.test.ts                        # new: unit test for the helper
└── app/(app)/settings/automations/
    ├── AutomationsTable.tsx                            # add "View runs" link per row
    └── [id]/
        └── runs/
            └── page.tsx                                 # new: run history page (server component, permission-gated like [id]/page.tsx)
```

**Structure Decision**: Single Next.js application, existing `src/features/automations` feature
folder (per constitution Code Organization: feature-owned implementation + tests together) plus
one new route segment under the existing settings routes. No new top-level directory, no new
package, no schema migration.

## Complexity Tracking

*No constitution violations — section not applicable.*
