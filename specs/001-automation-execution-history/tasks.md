# Tasks: Automation Execution History

**Input**: Design documents from `/specs/001-automation-execution-history/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/trpc-procedures.md, quickstart.md

**Tests**: Included per constitution Principle I (Test-First, NON-NEGOTIABLE) — every task below
that adds behavior is preceded by a task that writes its failing test first, using this
project's real-Postgres integration tests (no DB mocking).

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are exact and repo-relative

## Phase 1: Setup

No new dependencies, migrations, or project scaffolding are needed — this feature reuses the
existing `src/features/automations` structure and `src/app/(app)/settings/automations` routes.

## Phase 2: Foundational (blocking prerequisites)

These are shared by more than one user story and MUST complete before any user story phase
starts.

- [ ] T001 [P] Write failing unit test for the status-mapping helper in
  `src/features/automations/runHistoryStatus.test.ts`: assert every value of
  `automation_run_status` (`success`, `error`, `partial`) and every value of
  `automation_run_action_status` (`success`, `error`, `skipped`) maps to a defined
  `{ label, tone }` result, with no `undefined` fallthrough for an unrecognized value.
- [ ] T002 Implement `src/features/automations/runHistoryStatus.ts` exporting
  `runStatusPresentation(status: AutomationRunStatus): { label: string; tone: "success" | "error" | "warning" }`
  and `runActionStatusPresentation(status: AutomationRunActionStatus): { label: string; tone: "success" | "error" | "warning" }`
  to make T001 pass. Import the two status types from `src/db/schema/automations.ts`.
- [ ] T003 [P] Write failing integration test in `src/features/automations/rulesRepo.test.ts`
  for a new `listRunsForRule(db, ruleId, signal)` repo function: given a rule with 2 runs and
  another rule with 1 run, calling it with the first rule's id returns exactly its 2 runs,
  newest-first by `startedAt`; calling it with a rule id that has zero runs returns `[]`.
- [ ] T004 Implement `listRunsForRule` in `src/features/automations/rulesRepo.ts` (move the
  existing inline query out of `src/features/automations/router.ts` into this repo function,
  matching the existing `listAutomationRules`/`getAutomationRule` pattern) to make T003 pass:
  `SELECT * FROM automation_runs WHERE rule_id = :ruleId ORDER BY started_at DESC LIMIT 100`.
- [ ] T005 Update `automationsRouter.listRunsForRule` in `src/features/automations/router.ts`
  to call the new `listRunsForRule` repo function instead of querying inline, preserving its
  existing input/output contract (no client-visible change).
- [ ] T006 [P] Write failing integration test in `src/features/automations/rulesRepo.test.ts`
  for a new `listActionsForRun(db, runId, signal)` repo function: given a run with 3 actions
  inserted out of position order, calling it returns exactly those 3 rows ordered by
  `position` ascending; calling it with a run id that has zero actions (or does not exist)
  returns `[]`.
- [ ] T007 Implement `listActionsForRun` in `src/features/automations/rulesRepo.ts` to make
  T006 pass: `SELECT * FROM automation_run_actions WHERE run_id = :runId ORDER BY position ASC`.
- [ ] T008 Add `listActionsForRun` procedure to `automationsRouter` in
  `src/features/automations/router.ts`: input `{ runId: z.string().uuid() }`, calls the repo
  function from T007, gated by the existing `automationProcedure` (same `automation.manage`
  permission as every other procedure in this router). Add a matching integration test in
  `src/features/automations/router.test.ts` asserting the permission gate rejects a caller
  without `automation.manage` (mirroring the existing test for `listRunsForRule`/`get`).

**Checkpoint**: Foundation ready — both new repo functions and the new tRPC procedure exist,
tested against real Postgres, and the status-mapping helper is unit-tested. User story phases
can now build on this.

## Phase 3: User Story 1 - See whether a rule is running (Priority: P1) 🎯 MVP

**Goal**: From a rule's settings, an owner can see its executions listed newest-first, each
showing status, deal, and start time, with a clear empty state when there are none.

**Independent Test**: Trigger a rule, open its run history, confirm the run appears with a
status and the deal it ran on; open a never-triggered rule's history and confirm the empty
state.

- [ ] T009 [P] [US1] Add a "View runs" link per row to
  `src/app/(app)/settings/automations/AutomationsTable.tsx`, calling a new
  `onViewRuns: (id: string) => void` prop (added alongside the existing `onEdit`/`onDelete`
  props), rendered as a `Button variant="ghost"` matching the existing Edit/Delete buttons.
- [ ] T010 [US1] Wire `onViewRuns` in
  `src/app/(app)/settings/automations/AutomationsClient.tsx` to
  `router.push(`/settings/automations/${id}/runs`)`, matching the existing `onEdit` wiring.
- [ ] T011 [US1] Create
  `src/app/(app)/settings/automations/[id]/runs/page.tsx` as a server component, following the
  exact permission-gate and data-loading pattern of
  `src/app/(app)/settings/automations/[id]/page.tsx`: `createContext()`, `can(actor,
  "automation.manage")` guard (render `SETTINGS_STRINGS.requiresAdmin` on failure), load the
  rule via `getAutomationRule` (404 via `notFound()` if missing, same as the edit page), load
  its runs via the new `listRunsForRule` repo function, and render a `RunHistoryClient`
  client component with the rule name and runs as props.
- [ ] T012 [P] [US1] Create
  `src/app/(app)/settings/automations/[id]/runs/RunHistoryClient.tsx` ("use client"):
  renders a `SettingsPage`/`SettingsHeading` (titled with the rule's name, matching the edit
  page's header pattern) and a `RunHistoryTable` given the initial runs list.
- [ ] T013 [US1] Create
  `src/app/(app)/settings/automations/[id]/runs/RunHistoryTable.tsx`: a table (styled like
  `AutomationsTable.tsx`) with columns Started, Deal, Status; renders each run's status via
  `runStatusPresentation` from T002 as a colored badge (reuse the existing shadcn badge
  primitive under `src/components/ui/`, do not hand-roll); when `runs.length === 0`, renders
  "No runs yet for this automation." instead of an empty table (FR-008).
- [ ] T014 [US1] In `RunHistoryTable.tsx`, render each run's deal cell as a link to
  `/deals/${run.dealId}` (or this project's existing deal-workspace route path — confirm the
  exact route constant/helper already used elsewhere, e.g. in
  `src/features/collaboration` or `src/features/deal-workspace`, and reuse it rather than
  hardcoding a new path) satisfying FR-006.

**Checkpoint**: User Story 1 is independently functional — a rule's run history is visible,
correctly empty-stated, and deep-links to the deal. This alone is a shippable increment.

## Phase 4: User Story 2 - Understand why a run failed (Priority: P2)

**Goal**: A run with status `error` or `partial` shows its failure reason inline.

**Independent Test**: Trigger a rule whose action is guaranteed to fail (e.g. `send_email` with
no Gmail account connected), open the run history, confirm the failure reason is visible next
to that run.

- [ ] T015 [US2] In `RunHistoryTable.tsx` (from T013), add an error-message row/line beneath
  any run whose `status` is `"error"` or `"partial"`, showing `run.errorMessage` in
  `text-sm text-destructive` (matching the existing error-text convention in
  `AutomationsClient.tsx`); render nothing extra for a fully successful run (per spec
  Acceptance Scenario 2).

**Checkpoint**: User Stories 1 and 2 together give full single-action-rule diagnosability.

## Phase 5: User Story 3 - Inspect which action failed in a multi-action rule (Priority: P3)

**Goal**: Opening a run whose rule has more than one action shows each action's own outcome, in
order.

**Independent Test**: Create a two-action rule where the second action is guaranteed to fail,
trigger it, expand that run in the history view, confirm both actions show with independent
statuses in execution order.

- [ ] T016 [US3] Add an expand/collapse affordance per row in `RunHistoryTable.tsx` (a
  disclosure control using the existing shadcn `Collapsible`/`Accordion` primitive under
  `src/components/ui/` if one exists, otherwise add the standard shadcn wrapper for it first
  per the constitution's Design System Discipline — never a hand-rolled toggle).
- [ ] T017 [US3] On expand, fetch that run's actions via the tRPC client
  (`api.automations.listActionsForRun.useQuery({ runId })`, following this project's existing
  tRPC client-query conventions) and render each action's type and
  `runActionStatusPresentation` (from T002) status badge, in `position` order, inside the
  expanded row.
- [ ] T018 [US3] For an action whose `status === "error"`, show its own `errorMessage` beneath
  it, matching the styling introduced in T015.

**Checkpoint**: All three user stories complete — the feature fully satisfies spec.md.

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T019 [P] Run `pnpm lint` and fix any Biome/ESLint findings across all files touched by
  this feature (new files listed above plus `AutomationsTable.tsx`/`AutomationsClient.tsx`).
- [ ] T020 [P] Run `pnpm test:unit` and `pnpm test:integration` for the full
  `src/features/automations/` directory and confirm everything passes, not just the tests
  added in this feature (regression check on the refactor in T004/T005).
- [ ] T021 Walk through all four `quickstart.md` scenarios manually against the local dev stack
  and confirm each matches its expected outcome.

## Dependencies & Execution Order

- **Phase 2 (Foundational)** blocks every user story phase: T001-T002 (status helper) and
  T003-T008 (repo functions + new procedure) must all complete first.
- **User Story 1 (Phase 3)** depends only on Phase 2. It is the MVP: shippable alone.
- **User Story 2 (Phase 4)** depends on Phase 3 (extends `RunHistoryTable.tsx` from T013) but
  not on User Story 3.
- **User Story 3 (Phase 5)** depends on Phase 3 (extends `RunHistoryTable.tsx`) and on the
  `listActionsForRun` procedure from Phase 2 (T008). Independent of User Story 2's changes
  (different concern within the same file — sequence T015 before T016-T018 to avoid merge
  churn, but neither blocks the other's logic).
- **Polish (Phase 6)** runs after all desired user stories are complete.

## Parallel Execution Examples

Within Phase 2, these can run together (different files/tests, no shared state):

```text
T001 [P] runHistoryStatus.test.ts
T003 [P] rulesRepo.test.ts (listRunsForRule case)
T006 [P] rulesRepo.test.ts (listActionsForRun case)
```

Within Phase 3, after T011 (page.tsx) exists:

```text
T009 [P] AutomationsTable.tsx "View runs" link
T012 [P] RunHistoryClient.tsx
```

## Implementation Strategy

**MVP first**: Implement Phase 2 (Foundational) + Phase 3 (User Story 1) and ship. This alone
closes the "the one place the feature doesn't fully hang together end to end" gap from the
Phase 1 completion report — owners can already see that a rule ran and against which deal.

**Incremental delivery**: Add Phase 4 (User Story 2) next — it is a small, additive change to
the same component and delivers the diagnosability value that motivated this feature. Phase 5
(User Story 3) is the refinement for multi-action rules and can follow independently.
