# Contracts: automationsRouter additions

This project's interface contracts for internal features are tRPC procedures under
`src/features/automations/router.ts`. This feature adds one new procedure and reuses one
existing one; both sit behind the same `automationProcedure` permission gate
(`automation.manage`) already used by every other procedure in this router.

## `automationsRouter.listRunsForRule` (existing, reused as-is)

- **Input**: `{ ruleId: string (uuid) }`
- **Output**: `AutomationRun[]`, newest-first, capped at 100
- **Errors**: none beyond the shared permission gate (unknown `ruleId` returns an empty array,
  matching current behavior)
- **Change for this feature**: none. Consumed by the new run-history page as-is.

## `automationsRouter.listActionsForRun` (new)

- **Input**: `{ runId: string (uuid) }`
- **Output**: `AutomationRunAction[]`, ordered by `position` ascending
- **Errors**: none beyond the shared permission gate (unknown `runId` returns an empty array,
  same convention as `listRunsForRule`)
- **Behavior**: `SELECT * FROM automation_run_actions WHERE run_id = :runId ORDER BY position ASC`
- **Test contract**: integration test asserts a run with N actions returns exactly N rows in
  the order they were inserted, and a `runId` with no actions (or that does not exist) returns
  `[]` rather than throwing.
