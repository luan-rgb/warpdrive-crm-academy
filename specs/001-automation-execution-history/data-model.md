# Phase 1 Data Model: Automation Execution History

No schema changes. This feature reads two existing tables (`src/db/schema/automations.ts`,
already migrated in Phase 1) and introduces no new ones.

## Execution Run (`automation_runs`, existing)

| Field | Type | Notes for this feature |
|---|---|---|
| `id` | uuid | Row key; not shown to the user directly |
| `ruleId` | uuid, nullable | `ON DELETE SET NULL` — a deleted rule leaves its past runs orphaned; per spec Edge Cases, this feature only reaches runs through an existing rule's page, so orphaned runs are simply unreachable here (not displayed, not an error) |
| `ruleName` | text | Name-snapshotted at run time; not used by this feature (the rule's *current* name is shown by the page it's already on) |
| `dealId` | uuid | `ON DELETE CASCADE` — used for FR-006's deep link to the deal |
| `trigger` | enum | Not surfaced in the UI for this feature (redundant with "which rule you're viewing") |
| `status` | `success \| error \| partial` | Drives FR-004's visual distinction |
| `startedAt` | timestamptz | Sort key (desc) and the "when it started" shown per FR-003 |
| `finishedAt` | timestamptz, nullable | Null means not yet finished per the current data model (see Assumptions in spec.md re: provisional status); this feature displays it as-is, does not infer "in progress" |
| `errorMessage` | text, nullable | Shown per FR-005 when `status` is `error` or `partial` |

## Run Action (`automation_run_actions`, existing)

| Field | Type | Notes for this feature |
|---|---|---|
| `id` | uuid | Row key |
| `runId` | uuid | `ON DELETE CASCADE` from the parent run; foreign key for the new `listActionsForRun` query |
| `position` | integer | Ordering for FR-007 ("in the order it ran") |
| `actionType` | enum (`create_activity`, `send_notification`, `send_email`, `update_field`) | Displayed per action row |
| `status` | `success \| error \| skipped` | Per-action outcome for FR-007 |
| `errorMessage` | text, nullable | Shown when an individual action's status is `error` |
| `resultSummary` | jsonb, nullable | Not surfaced by this feature (no requirement calls for it); left for a future enhancement |

## Read shapes this feature adds

No new tables or columns. One new read query (see `contracts/`): given a `runId`, return its
`automation_run_actions` rows ordered by `position` ascending.
