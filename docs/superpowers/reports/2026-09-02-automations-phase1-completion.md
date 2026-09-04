# Automations Phase 1 — Completion Report

**Spec:** `docs/superpowers/specs/2026-09-02-automations-phase1-design.md`
**Plan:** `docs/superpowers/plans/2026-09-02-automations-phase1.md`
**Branch:** `automations-phase1` (merged to `main`, fast-forward, commit `7876e48`)
**Final state:** 354/354 integration test files, 1653/1653 tests green.

## What shipped

Pipedrive-style trigger → ordered-actions automation rules, scoped by pipeline, with an
execution log:

- **4 triggers:** deal created, deal stage changed, deal won/lost, specific field changed.
- **4 actions:** create activity, send internal notification, send automated email (from the
  deal owner's connected Gmail), update a deal field.
- Synchronous trigger *matching* inline in `createDeal`/`moveDeal`/`updateDeal` (no event bus,
  matching this codebase's existing convention); asynchronous *execution* via a new pg-boss job
  (`automation.execute`).
- Full CRUD UI in Settings → Automations: list page + 4-section creation/edit wizard, gated by
  a new `automation.manage` permission flag.
- Explicitly deferred to Phase 2 (not built): a "wait for condition" delay step, non-deal
  trigger entities, third-party integrations, chained multi-condition rule steps.

## Task-by-task

| Task | What | Commit range |
|---|---|---|
| 1 | Schema: 4 tables, 4 enums | `2044acb..967113e` |
| 2 | Zod schemas, error IDs, permission flag, notification type | `967113e..5c378ec` |
| 3 | Trigger evaluation core, wired into deal mutations | `5c378ec..d463d01` |
| 4 | Rule CRUD repo functions | `d463d01..792721b` |
| 5 | Action runners, `automation.execute` job, worker registration | `792721b..ac84a97` |
| 6 | Server actions + tRPC router | `ac84a97..3224f3d` |
| 7 | Settings UI list page | `3224f3d..827acaf` |
| 8 | Settings UI creation/edit wizard | `827acaf..5a4ffd5` |
| 9 | Full-suite verification, migration apply, smoke test | `5a4ffd5..7b3329f`* |
| Final review fix wave | Critical + Important findings from whole-branch review | `7b3329f..7876e48` |

\* Task 9 itself found and the controller fixed a real `pnpm lint` regression (import-order in
Task 1/3 files, unsafe casts in Task 5/8 files, a missing switch case in Task 2's notification
email renderer) — commit `7b3329f`.

## The critical bug the final review caught

`evaluateAutomations` was called with the deal mutation's own transaction (`tx`) from *inside*
`db.transaction(...)` in `createDeal`/`moveDeal`/`updateDeal`. `boss.send()` (pg-boss's job
enqueue) commits on its own connection pool, independent of `tx`. Consequence: a worker could
run the automation job before the outer transaction committed (silent no-op, deal not found
yet) or *after* the outer transaction rolled back (a real email or activity fires for a deal
mutation that never actually happened — not recoverable).

**Fix:** split into a match phase (`matchAutomationRules`, a pure read, still run inside `tx`)
and an enqueue phase (`enqueueAutomationRuns`, new export, no `db`/`tx` parameter by
construction) called only after `db.transaction()` resolves successfully, in all three
call sites.

## Other findings fixed in the same wave

- **Zod boundary:** `update_field.config.fieldKey` and `deal_field_changed.triggerConfig.fieldKey`
  now rejected at save time if invalid, instead of silently failing at execution.
- **Permission gap:** `automationsRouter`'s 3 tRPC read procedures gated on `automation.manage`
  (previously auth-only, while every other surface for the same data was gated).
- **Retry duplication:** `retryLimit: 0` on the `automation.execute` enqueue, since pg-boss's
  default retry would redeliver and duplicate non-idempotent side effects (a second real email).
- **Minor:** Save button now disables on zero actions; `runSendEmail` filters
  `status = 'connected'` in the query instead of picking an arbitrary row.
- **Test coverage:** added the two cases the design spec named but no task scheduled — a
  recursion-guard test and a rule-name-snapshot-survives-deletion test.

## Deliberately deferred (documented, not blocking)

- **Execution-history view.** `automationsRouter.listRunsForRule` exists and is now properly
  permission-gated, but no UI reads it yet — a failed run (e.g. `E_AUTOMATION_004`, no
  connected Gmail account) is invisible to users today. This is the one place the feature
  doesn't fully hang together end to end. Needs a small follow-up: a "View runs" affordance on
  the settings list page.
- **Wizard UX polish.** `deal_stage_changed`'s stage picker and `deal_field_changed`'s field-key
  input are free-text rather than proper `Select` pickers (the Zod-boundary fix above prevents
  invalid saves, but a picker would be better UX). Action reorder controls (up/down) are also
  missing; `position` is already derived correctly from array order, only the buttons are
  absent.
- **Provisional run status.** `automation_runs.status` is written as `"success"` before any
  action runs and only corrected after, because the `automation_run_status` enum has no
  `running`/`pending` state. A crash mid-run leaves a misleadingly "successful"-looking row.
  Needs a schema migration to add a real in-progress state.
- **Minor parked items:** `E_AUTOMATION_002` reused for an unrelated cause in
  `runCreateActivity` (should be `E_USER_001`); audit trail attributes automation edits to the
  deal owner personally rather than "Automation: <rule name>"; `AutomationWizard.tsx` is ~310
  lines, just over the ~300-line hard-split threshold.

## Notable infra incident during execution

Docker Desktop's VM disk (`Docker.raw`) grew to 48GB from accumulated Testcontainers Postgres
volumes across this plan's many integration test runs, filling the host disk to 94%+ used and
hanging the Docker daemon twice. Resolved by deleting `Docker.raw` entirely (full reset of
Docker's internal state — containers/images/volumes lost, no project files affected) rather
than pruning, since the daemon couldn't start to run a prune. User approved this explicitly.
