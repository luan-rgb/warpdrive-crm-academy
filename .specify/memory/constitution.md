<!--
Sync Impact Report
- Version change: [template] → 1.0.0 (initial ratification from existing CLAUDE.md conventions)
- Modified principles: n/a (first fill from template placeholders)
- Added sections: Core Principles I-VI, Security & Boundaries, Code Organization, Governance
- Removed sections: none
- Follow-up TODOs: RATIFICATION_DATE unknown (project predates spec-kit adoption)
-->

# warpdrive-crm-academy Constitution

## Core Principles

### I. Test-First (NON-NEGOTIABLE)
Every feature and every bugfix is written test-first: Red (write the smallest failing test,
watch it fail for the right reason) → Green (minimum code to pass) → Refactor (clean up with
the test as a safety net). A test that passes on first run is suspect and MUST be rewritten to
fail first. Bugfixes MUST start with a failing test that reproduces the bug; the fix comes only
after that failure is observed. Integration tests MUST hit a real Postgres test database
(disposable Docker container, real Drizzle migrations) — mocking the database is prohibited,
because mock/prod divergence hides exactly the broken queries and migrations a CRM cannot
afford to get wrong. Never claim work is done without running the test and seeing it pass.

### II. Result Types Over Throws
Any operation that can fail returns a discriminated union `Result<Ok, Err>` (`ok: true | false`)
instead of throwing; callers narrow with `if (!r.ok) return r`. Throwing is reserved for
programmer errors (invariant violations, unreachable branches) — never for operational failures
(bad input, missing record, timeout, permission denied), which are values. This matters most in
batch/parallel work (syncing many mailboxes, bulk operations), where one failure must not abort
the rest.

### III. Validate at the Boundary
External data passes through a Zod schema exactly once, at the point it enters the type system:
tRPC procedure inputs, server-action arguments, external API responses and push payloads, OAuth
callbacks, CSV import rows, file reads, and env vars. Inside the program, the inferred type is
trusted and never re-checked.

### IV. Single Env Boundary
`src/config/env.ts` is the only module that reads `process.env`. It validates with Zod and
throws at import time so misconfiguration fails fast at boot rather than at request time.
Every other module imports the typed `env` object; raw `process.env` access elsewhere is
lint-flagged and prohibited.

### V. Stable Error Identity
Every `AppError` carries a stable ID of the form `E_<DOMAIN>_<NNN>`, declared once in
`src/constants/errorIds.ts`. One ID per distinct cause; a retired ID is marked retired and kept
searchable, never reused or renumbered. `AppError(id, message, context)` is the only error
raised in application code — a raw `throw new Error(...)` is lint-flagged.

### VI. Cancellable Long Operations
Any function that does I/O, waits, or runs longer than ~100ms takes a required (not optional)
`signal: AbortSignal` and threads it through every callee that accepts one (fetch, DB client,
external clients, inner functions), calling `signal.throwIfAborted()` after awaits that are not
signal-aware themselves. Resources (handles, subprocesses, DB transactions) are released on
abort; `AbortError` is never swallowed. This keeps sync jobs and obsoleted requests genuinely
cancellable instead of piling up.

## Design System Discipline

This project is shadcn-based (`components.json`, new-york/slate tokens, cva/cn/tailwind-merge,
Radix primitives). Hand-rolling a component the design system already provides is prohibited:
before writing any interactive UI surface (menu, dialog, popover, tabs, tooltip, select), grep
`src/components/ui/` for an existing wrapper and `package.json` for an installed `@radix-ui/*`
dependency, and use it; if the Radix dependency exists but no wrapper does, add the standard
shadcn wrapper first. Dropdown menus MUST use the `DropdownMenu` primitive; modals MUST use the
`Dialog` primitive — never a hand-rolled dismiss hook or a `fixed inset-0` overlay, since those
silently drop focus trap, keyboard nav, and scroll-lock. Native HTML form controls
(`<select>`, `<input type=checkbox>`, etc.) are not permitted by default; use the design-system
wrapper, adding the standard shadcn wrapper first if none exists. Only genuinely presentational,
non-interactive helpers (`Button`, `Avatar`) may stay hand-rolled.

## Code Organization

Code is organized by feature under `src/features/`, not by technical layer: each feature holds
its implementation, types, constants, validation, and tests together. Files are kept small
(target under ~200 lines; split a single responsibility once it grows past ~300). Shared types
live in `src/types/` to break import cycles and are imported with `import type`. Named
constants live in `src/constants/` — no magic strings. Comments explain WHY, not what. Em dashes
are not used in any file; use commas, colons, parentheses, or "vs."/"or"/"to" instead.

## Tooling & Linting

Biome (`biome.json`) plus type-aware ESLint (`eslint.config.mjs`) are both enforced; `pnpm lint`
runs Biome then ESLint, and `eslint.config.mjs` is the source of truth for enabled rules. Test
runner is Vitest, split into a container-less `unit` project and a real-Postgres `integration`
project (`pnpm test:unit` / `pnpm test:integration`), with tests co-located inside the feature
directory (`src/features/<feature>/*.test.ts`).

## Git Safety

Force-pushing, skipping hooks, and committing secrets are all prohibited without exception.
Multi-line commit messages use heredoc syntax.

## Governance

This constitution supersedes ad hoc practice for this repository. Amendments are made via the
constitution-update workflow, require a documented Sync Impact Report (version bump, principle
changes, migration notes) prepended to this file, and take effect immediately on merge. Version
bumps follow semantic versioning: MAJOR for backward-incompatible governance or principle
removals/redefinitions, MINOR for a new principle or materially expanded guidance, PATCH for
wording/clarification only. All specs, plans, and code review for this project MUST verify
compliance with these principles; any deviation must be explicitly justified in the relevant
plan's Complexity Tracking section rather than silently introduced. Day-to-day development
guidance beyond governance lives in `CLAUDE.md`, which this constitution's principles were
derived from and must stay consistent with.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original project inception date not
tracked; this constitution formalizes pre-existing CLAUDE.md conventions as of adoption |
**Last Amended**: 2026-09-07
