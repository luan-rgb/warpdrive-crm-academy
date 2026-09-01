# Invoice module: Pipedrive/Xero-style parity

## Goal

Bring the `invoices` feature to functional parity with the invoice-creation flow Pipedrive
exposes through its Xero integration (the reference the user provided): a two-column
"Customer details / Invoice details" creation form, per-line tax rate, and a printed document
with a Subtotal / Tax / Total summary. Pipedrive has no native invoice document of its own — it
delegates to Xero/QuickBooks for creation and to Smart Docs/marketplace apps (e.g. Extraflow)
for the printable layout — so "parity" here means matching the fields and computed summary
those tools show, not porting a Pipedrive-owned template.

## Current state

`src/features/invoices/` already has: deal-linked invoices, a line-item snapshot taken from the
deal's products at generation time, status (`issued`/`paid`/`canceled`), sequential numbering
(`INV-0001`), a printable page with header/footer branding (logo + text, from company settings),
and an edit dialog for line items on an `issued` invoice. "Generate invoice" is a single button
with no form (today's date, no due date, no notes).

## Non-goals (explicitly cut)

- **Currency selector on the invoice.** `CompanyGeneralClient.tsx` already documents
  `baseCurrency` as "read-only… currencies out of scope" for the whole app. Adding a per-invoice
  currency would contradict that standing decision. Instead: fix the print page and edit dialog
  to format money with the existing `formatCurrency`/`readBaseCurrency` (they currently format
  numbers with no currency symbol at all — a real gap, fixed as part of this work since it's on
  the files already being touched).
- **Xero's "Account" field** (chart-of-accounts / bookkeeping category). Warpdrive isn't a
  ledger; there's no account list to select from.
- **Template picker, e-signature, link-open tracking.** Nothing in the current app models
  document templates or tracked links; out of scope for an internal billing record.
- **Fiscal/tax-authority validity.** `invoices.ts` already states the record is "not a fiscal
  document: no tax authority integration, no digital certificate." The tax fields added here are
  a display/arithmetic line on the printed document (rate % + computed amount), same spirit as
  Xero's field — not e-invoicing compliance.

## Data model changes

`src/db/schema/invoices.ts` — add, alongside the existing columns:

- `taxMode: pgEnum("invoice_tax_mode", ["exclusive", "inclusive", "none"])`, default `"exclusive"`
  — mirrors the Xero modal's "Amounts are: Tax exclusive / Tax inclusive / No tax" radio.
- `billToName: text`, `billToAddress: text`, `billToEmail: text`, `billToTaxId: text` (all
  nullable) — a **snapshot** of the customer, filled from the deal's org/person at creation time
  and editable before save. This also fixes a latent bug: the print page currently joins
  `organizations`/`persons` live by `deal.orgId`/`deal.personId`, so a later edit to the org's
  name silently rewrites the text on an already-issued invoice — the opposite of what the
  line-items snapshot comment on this same file promises ("an invoice is a historical document").
- `subtotal: numeric(14,2)`, `taxTotal: numeric(14,2)` — stored alongside the existing `total`
  (grand total), computed server-side, same pattern as the existing `total` recompute.

`src/db/schema/invoiceLineItems.ts` — add `taxRatePercent: numeric(5,2) notNull default '0'`,
same shape/constraints as the existing `discountPercent` column.

## Tax computation

Per line: `lineBase = quantity * unitPrice * (1 - discountPercent/100)`.

- `exclusive`: entered `unitPrice` excludes tax. `lineTax = lineBase * taxRatePercent/100`.
  `subtotal = Σ lineBase`, `taxTotal = Σ lineTax`, `total = subtotal + taxTotal`.
- `inclusive`: entered `unitPrice` includes tax. `lineBase` is still the displayed line amount;
  `lineTax = lineBase - lineBase / (1 + taxRatePercent/100)`. `subtotal = Σ lineBase - Σ lineTax`,
  `taxTotal = Σ lineTax`, `total = Σ lineBase` (unchanged by tax mode).
- `none`: `taxTotal = 0`, `subtotal = total = Σ lineBase`, `taxRatePercent` inputs are hidden.

This lives in `invoicesRepo.ts` next to the existing `lineTotal`/`recomputeInvoiceTotal`, and
runs on every line-item add/update/remove, exactly like the current total recompute.

## Creation flow

Today "Generate invoice" is a single click. Add a `CreateInvoiceDialog` (new file,
`src/features/invoices/CreateInvoiceDialog.tsx`) opened by the existing "Generate invoice"
button, laid out as two columns matching the reference screenshot:

- **Customer details**: name, address, email, tax ID — pre-filled from the deal's org (`name`,
  `address` — the jsonb shape gets flattened to a single-line string for this text field) and
  person (`primaryEmail`); no `taxId` exists anywhere in the schema today, so it's a plain
  optional text input with no default. All four fields editable before creating.
- **Invoice details**: Amounts-are radio (exclusive/inclusive/none), issue date, due date, notes.
  No "Currency" or "Template" field (see Non-goals).
- **Items**: reuses the same product-picker pattern as `InvoiceEditDialog`'s "Add item" row, but
  seeded from the deal's current line items (same source `createInvoiceFromDeal` already reads),
  each row gaining a tax-rate-percent input next to the existing discount input. Running
  Subtotal / Tax / Total footer, computed client-side with the same formulas above for preview.

`createInvoiceInputSchema` (`invoiceSchema.ts`) gains `taxMode`, `billToName`, `billToAddress`,
`billToEmail`, `billToTaxId` (all optional except `taxMode`, which defaults to `"exclusive"`).
`createInvoiceFromDeal` (`invoicesRepo.ts`) computes `subtotal`/`taxTotal`/`total` instead of just
`total`, and copies the per-line `taxRatePercent` the dialog submitted onto the line-item
snapshot (0 by default if the caller omits it, so existing callers/tests keep working).

## Edit dialog changes

`InvoiceEditDialog.tsx` gains a "Tax %" input column next to "Discount %" (same `Input` +
`updateInvoiceLineItemInputSchema` pattern), and its footer changes from a single "Total" row to
Subtotal / Tax / Total, matching the create dialog and print page.

## Print page changes

`src/app/(invoice-print)/invoices/[invoiceId]/page.tsx`:

- Stop joining `organizations`/`persons` live; read `billToName`/`billToAddress`/`billToEmail`/
  `billToTaxId` off the invoice row itself (the snapshot). Falls back to the existing `deal.title`
  line underneath, unchanged.
- Money formatting switches from the bare `Intl.NumberFormat` (`money()` helper, no currency
  symbol) to `formatCurrency` fed by `readBaseCurrency`, matching how the rest of the app shows
  money.
- Line-item table gains a "Tax %" column between Discount and Total (hidden when the invoice's
  `taxMode` is `"none"`, so an invoice with no tax doesn't show an empty column of zeros).
- Totals block below the table becomes Subtotal / Tax (labelled with the mode, e.g. "Tax 18%" —
  Xero's reference document does this per-rate; since warpdrive invoices can mix rates per line,
  this shows a single aggregate "Tax" row, not one row per rate, to avoid a variable-height
  summary block) / Total, replacing the current single "Total" row.

## Error IDs

`src/constants/errorIds.ts` — no new error codes needed; the new fields are optional/defaulted at
the Zod boundary, so a missing `billToName` etc. is a valid input, not a validation failure.

## Migration

One Drizzle migration: `invoice_tax_mode` enum, five new nullable/defaulted columns on
`invoices`, one new `numeric(5,2) not null default '0'` column on `invoice_line_items`. Additive
only, no backfill needed (existing rows get the defaults).

## Testing

Per `CLAUDE.md`: test-first, integration tests against real Postgres, no DB mocks.

- `invoicesRepo.test.ts`: extend the tax-computation cases for all three `taxMode` values
  (exclusive/inclusive/none), including a multi-rate invoice (two lines at different
  `taxRatePercent`), and a case asserting the bill-to snapshot survives an org name change made
  after invoice creation (the bug this design fixes — write the failing test first).
- `CreateInvoiceDialog`: a new colocated test file covering the pre-fill from deal org/person, the
  running Subtotal/Tax/Total preview, and submission wiring (existing `InvoiceEditDialog`/
  `InvoicesPanel` tests are the pattern to follow for tRPC/action mocking).
- `InvoiceEditDialog.test.tsx` (if one doesn't already exist alongside it, check first): add the
  tax-column input and updated footer.
