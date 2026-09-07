# Feature Specification: Automation Execution History

**Feature Branch**: `001-automation-execution-history`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Automations Phase 1 shipped a working trigger→actions engine and
`automationsRouter.listRunsForRule`, but no UI reads it. A rule can fail silently (e.g. no
connected Gmail account for a send_email action) and the owner never finds out. Give automation
owners a way to see whether their rules are actually running, and why a run failed when it did."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See whether a rule is running (Priority: P1)

An automation owner opens one of their rules from the Automations settings page and sees a list
of its recent executions: when each one ran, which deal it fired on, and whether it succeeded.

**Why this priority**: Without this, a rule that silently stopped working (or never worked) is
indistinguishable from one that simply hasn't been triggered yet. This is the baseline trust
signal the whole feature exists for.

**Independent Test**: Create a rule, trigger it by satisfying its condition on a deal (e.g.
change a deal's stage for a `deal_stage_changed` rule), then open the rule and see the run
listed with a status.

**Acceptance Scenarios**:

1. **Given** a rule that has run at least once, **When** its owner opens the rule's detail view,
   **Then** they see its executions listed newest-first, each showing status, the deal it ran
   against, and when it started.
2. **Given** a rule that has never run, **When** its owner opens the rule's detail view, **Then**
   they see a message that says so, not a blank or broken table.

---

### User Story 2 - Understand why a run failed (Priority: P2)

An automation owner sees a run marked as failed and can read the reason without needing to ask
an engineer or check server logs.

**Why this priority**: A visible failure the owner cannot explain is only slightly better than an
invisible one — they still cannot fix it. The error message is what turns "it broke" into "I
need to reconnect Gmail."

**Independent Test**: Trigger a rule whose action is guaranteed to fail (e.g. a `send_email`
action with no Gmail account connected), then open the run history and confirm the failure
reason is shown in plain terms next to that run.

**Acceptance Scenarios**:

1. **Given** a run with status "error" or "partial", **When** its owner views that run, **Then**
   they see the error reason displayed with it.
2. **Given** a run that succeeded fully, **When** its owner views that run, **Then** no error
   text is shown for it.

---

### User Story 3 - Inspect which specific action failed in a multi-action rule (Priority: P3)

A rule with more than one action (e.g. "create an activity, then send a notification") partially
fails. The owner can see, action by action, which ones succeeded and which one failed.

**Why this priority**: Valuable for rules with multiple actions, but a single-action rule (most
rules today) gets full diagnostic value from User Story 2 alone. This is a refinement, not a
blocker to shipping the core history view.

**Independent Test**: Create a rule with two actions where the second is set up to fail, trigger
it, and confirm the run's detail view shows both actions with independent statuses.

**Acceptance Scenarios**:

1. **Given** a run whose rule has multiple actions, **When** its owner expands or opens that
   run's detail, **Then** they see each action's type and outcome (success, error, or skipped)
   listed in the order it ran.

---

### Edge Cases

- What happens when a rule has more than 100 past runs? Only the 100 most recent are shown
  (matches the existing backend limit); this is a known, accepted boundary, not a bug.
- What happens if the rule that produced a run has since been deleted? Out of scope for this
  feature: history is reached by navigating from an existing rule, so a deleted rule's past runs
  (still stored, name-snapshotted) are not reachable through this UI. Noted as a follow-up, not a
  requirement here.
- What happens for a run that is still in progress when the owner looks? The system does not yet
  track an in-progress state at the data layer (a separate, already-known gap); this feature
  displays whatever status is currently stored and does not attempt to infer or fix that
  limitation. See Assumptions.
- What happens when a deal a run acted on has since been deleted? The run row itself is deleted
  too (the deal reference cascades), so it simply will not appear; no dangling-reference display
  is needed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let an automation owner navigate from a rule (in the Automations
  settings list) to that rule's execution history.
- **FR-002**: The system MUST display a rule's execution history as a list ordered from most
  recent to oldest.
- **FR-003**: Each history entry MUST show: when it started, its outcome status, and which deal
  it ran against.
- **FR-004**: The system MUST visually distinguish the three possible outcome statuses (fully
  succeeded, fully failed, partially succeeded) from one another at a glance.
- **FR-005**: For any entry that did not fully succeed, the system MUST show the reason for the
  failure in plain, readable text.
- **FR-006**: The system MUST let the owner navigate from a history entry to the specific deal
  record it acted on.
- **FR-007**: For a rule with more than one action, the system MUST let the owner see the
  outcome of each individual action within a given run, in the order the actions ran.
- **FR-008**: When a rule has no execution history yet, the system MUST show a clear empty state
  rather than an empty or broken list.
- **FR-009**: Only users permitted to manage the rule MUST be able to view its execution history
  (same permission boundary already governing automation management).

### Key Entities

- **Execution Run**: One firing of a rule against one deal. Has a start time, an optional finish
  time, an overall outcome status, and, for a failed or partial outcome, a failure reason. Belongs
  to the rule that produced it and the deal it acted on.
- **Run Action**: One action's outcome within a single Execution Run, in the order it executed:
  its type, its outcome status (succeeded, failed, or skipped), and, if failed, its own failure
  reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An automation owner can determine, within one navigation step from the Automations
  settings list, whether a given rule has run recently and what happened.
- **SC-002**: An automation owner can identify the reason a specific run failed without
  contacting support or reading server logs.
- **SC-003**: For a rule with multiple actions, an owner can identify which specific action
  failed in a partially-successful run, not just that the run as a whole was "partial".
- **SC-004**: The 100 most recent runs of any rule are fully visible through this view (matching
  the existing retention already implemented in the backend).

## Assumptions

- The backend already retains execution history (rule, deal, status, timestamps, per-action
  detail, error messages) with no schema changes needed to serve this feature.
- History is scoped to rules that still exist; viewing history for a deleted rule is explicitly
  out of scope (see Edge Cases).
- The 100-run-per-rule cap already enforced by the existing backend query is accepted as-is for
  this feature; expanding it is a separate concern.
- The current data model can mark a run "successful" before all of its actions have actually
  finished, and does not yet have a true in-progress state; this feature surfaces whatever status
  is stored and does not fix that underlying gap (tracked separately as "Provisional run status"
  in the Phase 1 completion report).
- "Permitted to manage the rule" reuses the automations feature's existing permission gate; this
  feature does not introduce a new permission model.
