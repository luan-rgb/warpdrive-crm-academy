# Quickstart: Automation Execution History

Manual end-to-end validation once implementation is complete.

## Prerequisites

- Local dev stack running (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`)
- Signed in as a user with `automation.manage` permission
- At least one automation rule exists (create one via Settings → Automations if needed)

## Scenario 1: Rule with a successful run (User Story 1)

1. Trigger the rule's condition (e.g. move a deal into the stage a `deal_stage_changed` rule
   watches).
2. Open Settings → Automations → the rule → its run history.
3. **Expect**: the run appears at the top of the list with status "success" (or your locale's
   equivalent visual treatment), the deal it ran on, and a start time close to when you
   triggered it.

## Scenario 2: Failed run shows a reason (User Story 2)

1. Disconnect (or never connect) Gmail for the rule owner, then trigger a rule whose action is
   `send_email`.
2. Open that rule's run history.
3. **Expect**: the run shows an "error" status and a readable failure message referencing the
   missing Gmail connection (`E_AUTOMATION_004`), without needing to check server logs.

## Scenario 3: Multi-action rule, partial failure (User Story 3)

1. Create a rule with two actions: one guaranteed to succeed (`create_activity`), one guaranteed
   to fail (`send_email` with no Gmail connected).
2. Trigger it, then open the run in history and expand/open its detail.
3. **Expect**: the run's overall status is "partial", and the per-action breakdown shows the
   first action as succeeded and the second as failed, in that order, with the second action's
   own failure reason.

## Scenario 4: Empty state (spec Edge Cases / FR-008)

1. Create a brand-new rule that has never been triggered.
2. Open its run history.
3. **Expect**: a clear "no runs yet" message, not a blank table or an error.

## Automated coverage

- `src/features/automations/router.test.ts` (integration, real Postgres): `listActionsForRun`
  returns ordered actions for a run, and `[]` for a run with none.
- `src/features/automations/runHistoryStatus.test.ts` (unit): every enum value of
  `automation_run_status` and `automation_run_action_status` maps to a defined label/tone, no
  `undefined` fallthrough.
