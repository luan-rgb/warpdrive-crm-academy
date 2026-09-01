# Invoice Pipedrive/Xero Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tax modes (exclusive/inclusive/none), a per-line tax rate, and a snapshotted
customer (bill-to) record to the invoice feature, plus a proper "Create invoice" form, so the
module matches the fields and computed summary Pipedrive's Xero integration and printed
documents show.

**Architecture:** Additive schema changes on `invoices`/`invoice_line_items`, tax math added to
the existing repo-layer total-recompute functions, a new `CreateInvoiceDialog` replacing the
single-click "Generate invoice" button, and matching updates to the edit dialog and print page.
No new tRPC procedures or server actions: the org/person data needed to prefill the customer
fields is already loaded by the deal workspace and threaded down as props, the same way
`baseCurrency` already is.

**Tech Stack:** Next.js App Router, Drizzle ORM + Postgres, tRPC, Zod, Vitest (`unit` +
`integration` projects), shadcn/ui + Radix, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-01-invoice-pipedrive-parity-design.md`

## Global Constraints

- Test-first: every step below that touches behavior starts with a failing test (CLAUDE.md,
  "Test-Driven Development (required)").
- No DB mocks: `invoicesRepo.test.ts` runs against a real Postgres via `withTestDb` (CLAUDE.md).
- External data validated once at the Zod boundary (`invoiceSchema.ts`); nothing re-validates
  inside `invoicesRepo.ts`.
- Money fields are decimal strings (`numeric` columns), matching the existing `total`/
  `unitPrice`/`discountPercent` convention — never `number` in the DB or in Zod schemas.
- No unrequested abstractions: no currency selector (app-wide "currencies out of scope" decision
  in `CompanyGeneralClient.tsx`), no chart-of-accounts field, no template picker.
- Biome + ESLint clean (`pnpm lint`) and `pnpm typecheck` clean before each commit.

---

## Task 1: Schema — tax mode, bill-to snapshot, per-line tax rate

**Files:**
- Modify: `src/db/schema/invoices.ts`
- Modify: `src/db/schema/invoiceLineItems.ts`
- Create: `drizzle/00NN_<generated_name>.sql` (via `pnpm db:generate`, name picked by drizzle-kit)

**Interfaces:**
- Produces: `INVOICE_TAX_MODE` (`readonly ["exclusive", "inclusive", "none"]`), `InvoiceTaxMode`
  type, `invoiceTaxMode` pg enum, and five new nullable/defaulted columns on `Invoice` —
  `taxMode: InvoiceTaxMode`, `billToName: string | null`, `billToAddress: string | null`,
  `billToEmail: string | null`, `billToTaxId: string | null`, `subtotal: string`,
  `taxTotal: string`. Produces `taxRatePercent: string` on `InvoiceLineItem`. Task 2 imports
  `InvoiceTaxMode` from this file.

- [ ] **Step 1: Add the tax-mode enum and new columns to `invoices.ts`**

Replace the full contents of `src/db/schema/invoices.ts` with:

```ts
import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { deals } from "./deals";

export const INVOICE_STATUS = ["issued", "paid", "canceled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];
export const invoiceStatus = pgEnum("invoice_status", INVOICE_STATUS);

// How the entered unit prices relate to invoice.taxTotal: "exclusive" prices exclude tax (tax is
// added on top), "inclusive" prices already include tax (tax is backed out of the price), "none"
// means no tax line at all. Mirrors the "Amounts are" radio on the reference Xero create-invoice
// form. Purely a display/arithmetic line, not a fiscal computation (see the comment below).
export const INVOICE_TAX_MODE = ["exclusive", "inclusive", "none"] as const;
export type InvoiceTaxMode = (typeof INVOICE_TAX_MODE)[number];
export const invoiceTaxMode = pgEnum("invoice_tax_mode", INVOICE_TAX_MODE);

// Internal billing record, not a fiscal document: no tax authority integration, no digital
// certificate. It tracks what was billed and whether it was paid, for the CRM's own records.
// sequenceNumber is a plain identity column; the human-facing "INV-0001" label is derived from
// it at render time rather than stored, so a display-format change never touches historical rows.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceNumber: integer("sequence_number").generatedAlwaysAsIdentity(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").notNull().default("issued"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    notes: text("notes"),
    // numeric(14,2): same convention as deals.value and products.price.
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    // subtotal excludes tax, taxTotal is the computed tax line; total = subtotal + taxTotal
    // always holds (in "inclusive" mode subtotal is backed out of tax-included line prices).
    // Stored rather than derived at render time because line items can later be edited while an
    // invoice is still "issued", and recomputeInvoiceTotal already owns that recompute.
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 14, scale: 2 }).notNull().default("0"),
    taxMode: invoiceTaxMode("tax_mode").notNull().default("exclusive"),
    // Customer snapshot, taken from the deal's org/person at creation time (createInvoiceFromDeal
    // fills these when the caller doesn't supply them). Never re-read live from organizations/
    // persons: an invoice is a historical document, so a later org rename must not rewrite it.
    billToName: text("bill_to_name"),
    billToAddress: text("bill_to_address"),
    billToEmail: text("bill_to_email"),
    billToTaxId: text("bill_to_tax_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("invoices_deal_idx").on(t.dealId, t.createdAt)],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
```

- [ ] **Step 2: Add `taxRatePercent` to `invoiceLineItems.ts`**

Replace the full contents of `src/db/schema/invoiceLineItems.ts` with:

```ts
import { integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { invoices } from "./invoices";

// A snapshot of the deal's line items at the moment the invoice was issued: an invoice is a
// historical document, so a later price edit or removal on the deal's own products must not
// silently rewrite a bill already sent. No updatedAt: a snapshot row is never edited after
// creation, only the parent invoice's status changes.
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull(),
  taxRatePercent: numeric("tax_rate_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  position: integer("position").notNull().default(0),
});

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`

Expected: a new `drizzle/00NN_<name>.sql` and matching `drizzle/meta/00NN_snapshot.json` appear,
containing `CREATE TYPE "invoice_tax_mode"` and `ALTER TABLE "invoices" ADD COLUMN ...` /
`ALTER TABLE "invoice_line_items" ADD COLUMN "tax_rate_percent" ...` statements. Read the
generated SQL to confirm it only adds columns/the enum (no drops, no renames) — drizzle-kit
occasionally misreads a column rename as drop+add; there is no rename here, so the diff should be
purely additive.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers reference the new fields yet, so nothing should break).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/invoices.ts src/db/schema/invoiceLineItems.ts drizzle/
git commit -m "feat(invoices): add tax mode, bill-to snapshot, and per-line tax rate columns"
```

---

## Task 2: Zod schemas for the new fields

**Files:**
- Modify: `src/features/invoices/invoiceSchema.ts`

**Interfaces:**
- Consumes: `INVOICE_STATUS` from `@/db/schema/invoices` (already imported); `INVOICE_TAX_MODE`
  from the same file (Task 1).
- Produces: `createInvoiceInputSchema` gains `taxMode` (defaults `"exclusive"`), `billToName`,
  `billToAddress`, `billToEmail`, `billToTaxId` (all `string | null`, default `null`), and
  `lineTaxRates` (`string[]`, optional — positional, aligned to the deal's line items in
  `position` order). `addInvoiceLineItemInputSchema` and `updateInvoiceLineItemInputSchema` gain
  `taxRatePercent` (same shape as the existing `discountPercent` field; optional/defaulted `"0"`
  on add, required on update). A new exported `taxRatePercent` schema, next to the existing
  `money` schema, used by both. Task 3 (`invoicesRepo.ts`) consumes all of the above via the
  existing `CreateInvoiceInput` / `AddInvoiceLineItemInput` / `UpdateInvoiceLineItemInput` types.

- [ ] **Step 1: Replace the full contents of `invoiceSchema.ts`**

```ts
import { z } from "zod";
import { INVOICE_STATUS, INVOICE_TAX_MODE } from "@/db/schema/invoices";

export const createInvoiceInputSchema = z.object({
  dealId: z.string().uuid(),
  issueDate: z.string().date(),
  dueDate: z.string().date().nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  taxMode: z.enum(INVOICE_TAX_MODE).default("exclusive"),
  billToName: z.string().trim().max(200).nullable().default(null),
  billToAddress: z.string().trim().max(500).nullable().default(null),
  billToEmail: z.string().trim().max(200).nullable().default(null),
  billToTaxId: z.string().trim().max(100).nullable().default(null),
  // Positional: index i is the tax rate for the i-th line item createInvoiceFromDeal snapshots
  // from the deal (deal_products ordered by position, same order the create dialog fetched them
  // in). Missing/short arrays default the remaining lines to "0".
  lineTaxRates: z.array(z.string()).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const updateInvoiceStatusInputSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(INVOICE_STATUS),
});
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusInputSchema>;

export const deleteInvoiceInputSchema = z.object({ id: z.string().uuid() });

const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) >= 0, { message: "must not be negative" });

const percent = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "must be between 0 and 100" });

export const addInvoiceLineItemInputSchema = z.object({
  invoiceId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: money.default("1"),
  unitPrice: money.optional(),
  discountPercent: percent.default("0"),
  taxRatePercent: percent.default("0"),
});
export type AddInvoiceLineItemInput = z.infer<typeof addInvoiceLineItemInputSchema>;

export const updateInvoiceLineItemInputSchema = z.object({
  id: z.string().uuid(),
  quantity: money,
  unitPrice: money,
  discountPercent: percent,
  taxRatePercent: percent,
});
export type UpdateInvoiceLineItemInput = z.infer<typeof updateInvoiceLineItemInputSchema>;

export const removeInvoiceLineItemInputSchema = z.object({ id: z.string().uuid() });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. `invoicesRepo.ts` only reads `input.dealId`/`issueDate`/`dueDate`/`notes` today,
so the new `CreateInvoiceInput` fields being unused there is not a type error — TypeScript
doesn't require every property of a typed parameter to be consumed. Wiring `invoicesRepo.ts` to
actually use the new fields is Task 3's job.

- [ ] **Step 3: Commit**

```bash
git add src/features/invoices/invoiceSchema.ts
git commit -m "feat(invoices): add tax and bill-to fields to invoice Zod schemas"
```

---

## Task 3: Tax computation and bill-to snapshot in `invoicesRepo.ts`

**Files:**
- Modify: `src/features/invoices/invoicesRepo.ts`
- Test: `src/features/invoices/invoicesRepo.test.ts`

**Interfaces:**
- Consumes: `InvoiceTaxMode` from `@/db/schema/invoices` (Task 1); `CreateInvoiceInput` etc. from
  `./invoiceSchema` (Task 2); `organizations` from `@/db/schema/organizations`; `persons` from
  `@/db/schema/persons`.
- Produces: `createInvoiceFromDeal` now populates `taxMode`, `billToName`, `billToAddress`,
  `billToEmail`, `billToTaxId`, `subtotal`, `taxTotal` on the created invoice, and
  `taxRatePercent` on each snapshotted line. `addInvoiceLineItem`/`updateInvoiceLineItem`/
  `removeInvoiceLineItem` keep `subtotal`/`taxTotal`/`total` in sync via a taxMode-aware
  recompute. No exported function signatures change (same params, same `Result<...>` returns) —
  only the row shapes they read/write grow, so Task 4/5 call sites don't need new imports beyond
  what they already have.

- [ ] **Step 1: Write the failing tests for tax computation and the bill-to snapshot bug fix**

This step adds every Red test for this task in one batch — the tax-computation tests below, plus
the bill-to-snapshot regression test — so the implementation in Step 3 is written once against a
complete set of failing tests, per CLAUDE.md's "bugfixes start with a failing test that
reproduces the bug" (the snapshot fix is a bugfix, not just a feature addition).

Add to `src/features/invoices/invoicesRepo.test.ts` (near the existing "creates an invoice from a
won deal's current products" test):

```ts
it("computes subtotal/tax/total for a tax-exclusive invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "2"); // base 200.00

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.subtotal).toBe("200.00");
      expect(result.value.invoice.taxTotal).toBe("20.00");
      expect(result.value.invoice.total).toBe("220.00");
      expect(result.value.lines[0]?.taxRatePercent).toBe("10");
    }
  });
});

it("computes subtotal/tax/total for a tax-inclusive invoice", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "110.00", "1"); // base 110.00, 10% inclusive

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "inclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.total).toBe("110.00");
      expect(result.value.invoice.taxTotal).toBe("10.00");
      expect(result.value.invoice.subtotal).toBe("100.00");
    }
  });
});

it("defaults to no tax when taxMode is 'none', ignoring any tax rate", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "50.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "none",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["10"],
      },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.taxTotal).toBe("0.00");
      expect(result.value.invoice.subtotal).toBe("50.00");
      expect(result.value.invoice.total).toBe("50.00");
    }
  });
});

it("defaults missing lineTaxRates entries to 0, so existing minimal callers keep working", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "10.00", "1");

    const result = await createInvoiceFromDeal(
      db,
      { dealId, issueDate: "2026-08-31", dueDate: null, notes: null },
      sig(),
    );
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.invoice.taxMode).toBe("exclusive");
      expect(result.value.invoice.taxTotal).toBe("0.00");
      expect(result.value.lines[0]?.taxRatePercent).toBe("0");
    }
  });
});

async function seedOrg(db: Db, ownerId: string, name: string): Promise<string> {
  const row = (
    await db.execute(sql`
      INSERT INTO organizations (name, owner_id, visibility_level)
      VALUES (${name}, ${ownerId}, 'all')
      RETURNING id
    `)
  ).rows[0] as { id: string } | undefined;
  if (row === undefined) throw new Error("seedOrg: insert returned no rows");
  return row.id;
}

it("snapshots the bill-to name at creation time, unaffected by a later org rename", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const orgId = await seedOrg(db, user.id, "Original Org Name");
    const { pipeline, stages } = await seedPipelineWithStages(db, ["Open"]);
    const stage = stages[0];
    if (stage === undefined) throw new Error("no stage");
    const dealRow = (
      await db.execute(sql`
        INSERT INTO deals (title, pipeline_id, stage_id, owner_id, visibility_level, status, org_id)
        VALUES ('Test Deal', ${pipeline.id}, ${stage.id}, ${user.id}, 'all', 'won', ${orgId})
        RETURNING id
      `)
    ).rows[0] as { id: string } | undefined;
    if (dealRow === undefined) throw new Error("no deal");
    await seedProductOnDeal(db, dealRow.id, "10.00", "1");

    const created = await createInvoiceFromDeal(
      db,
      { dealId: dealRow.id, issueDate: "2026-08-31", dueDate: null, notes: null },
      sig(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.invoice.billToName).toBe("Original Org Name");

    await db.execute(sql`UPDATE organizations SET name = 'Renamed Org' WHERE id = ${orgId}`);

    const reread = await getInvoice(db, created.value.invoice.id, sig());
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.invoice.billToName).toBe("Original Org Name");
    }
  });
});
```

`sql` and `Db` are already imported at the top of this file (the existing `seedDeal` helper uses
both) — no new imports needed for this step.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:integration -- invoicesRepo`
Expected: FAIL on all five new tests — the four tax-computation ones because
`result.value.invoice.subtotal`/`taxTotal` come back at their DB-default `"0.00"` instead of the
computed values (`createInvoiceFromDeal` doesn't read `taxMode`/`lineTaxRates` yet), and the
bill-to snapshot one because `invoice.billToName` is `null` (`createInvoiceFromDeal` doesn't
default it from the org yet).

- [ ] **Step 3: Add tax computation and the bill-to snapshot, wire both into `createInvoiceFromDeal`**

In `src/features/invoices/invoicesRepo.ts`, add near the top-level `lineTotal` function (after
the imports):

```ts
import type { InvoiceTaxMode } from "@/db/schema/invoices";
```

Add this block right after the existing `lineTotal` function (defined later in the file, around
line 132 today — move it above `createInvoiceFromDeal` since the new code needs it earlier, or
duplicate the one-line pattern already used for `recomputeInvoiceTotal`'s private `lineTotal`;
simplest is to hoist the existing `function lineTotal(...)` definition to just below the imports
so both `createInvoiceFromDeal` and `recomputeInvoiceTotal` can use it):

```ts
function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

// Tax on one line's base amount, in the given mode. "exclusive" adds tax on top of base;
// "inclusive" backs the tax out of a base that already includes it; "none" has no tax line.
// Purely arithmetic (see the fiscal-document comment on the invoices table) — not a tax-authority
// computation, so there is no rounding-rule table or jurisdiction lookup here.
function lineTaxAmount(base: number, taxRatePercent: string, taxMode: InvoiceTaxMode): number {
  if (taxMode === "none") return 0;
  const rate = Number(taxRatePercent) / 100;
  if (taxMode === "inclusive") return base - base / (1 + rate);
  return base * rate;
}

interface TaxableLine {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRatePercent: string;
}

function computeInvoiceTotals(
  lines: TaxableLine[],
  taxMode: InvoiceTaxMode,
): { subtotal: number; taxTotal: number; total: number } {
  let base = 0;
  let tax = 0;
  for (const l of lines) {
    const lineBase = lineTotal(l.quantity, l.unitPrice, l.discountPercent);
    base += lineBase;
    tax += lineTaxAmount(lineBase, l.taxRatePercent, taxMode);
  }
  if (taxMode === "inclusive") {
    return { subtotal: base - tax, taxTotal: tax, total: base };
  }
  return { subtotal: base, taxTotal: tax, total: base + tax };
}

// Flattens the org.address JSONB shape (street/city/region/postal/country, same keys the
// Organization sidebar edits — see OrgBlock.tsx's formatAddress) into one display line for the
// bill-to snapshot. Duplicated here rather than imported: the sidebar's copy lives in a
// "use client" file, and this repo module is server-only.
const ADDRESS_KEYS = ["street", "city", "region", "postal", "country"] as const;
function formatAddress(address: Record<string, unknown> | null): string | null {
  if (address === null) return null;
  const parts = ADDRESS_KEYS.map((key) => address[key]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : null;
}
```

Remove the now-duplicate later definition of `function lineTotal(...)` (currently just above
`recomputeInvoiceTotal`) so there is exactly one copy.

Add the imports it needs, alongside the existing `deals`/`products` imports:

```ts
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
```

Replace `createInvoiceFromDeal`'s body (from the `const dealLines = ...` line through the `return
ok(result);` line) with:

```ts
  const dealLines = await listDealProducts(db, input.dealId, signal);
  if (dealLines.length === 0) {
    return err(
      new AppError(ERROR_IDS.INVOICE_NO_LINE_ITEMS, "deal has no products to invoice", {
        dealId: input.dealId,
      }),
    );
  }

  const org =
    deal.orgId != null
      ? (await db.select().from(organizations).where(eq(organizations.id, deal.orgId)))[0]
      : undefined;
  const person =
    deal.personId != null
      ? (await db.select().from(persons).where(eq(persons.id, deal.personId)))[0]
      : undefined;

  const billToName = input.billToName ?? org?.name ?? person?.name ?? null;
  const billToAddress = input.billToAddress ?? formatAddress(org?.address ?? null);
  const billToEmail = input.billToEmail ?? person?.primaryEmail ?? null;
  const billToTaxId = input.billToTaxId;

  const taxRates = input.lineTaxRates ?? [];
  const taxableLines: TaxableLine[] = dealLines.map((line, i) => ({
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    taxRatePercent: taxRates[i] ?? "0",
  }));
  const { subtotal, taxTotal, total } = computeInvoiceTotals(taxableLines, input.taxMode);

  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        dealId: input.dealId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        notes: input.notes,
        taxMode: input.taxMode,
        billToName,
        billToAddress,
        billToEmail,
        billToTaxId,
        subtotal: subtotal.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        total: total.toFixed(2),
      })
      .returning();
    if (invoice === undefined) {
      throw new AppError(
        ERROR_IDS.DB_INSERT_FAILED,
        "createInvoiceFromDeal: insert returned no rows",
      );
    }
    const lines = await tx
      .insert(invoiceLineItems)
      .values(
        dealLines.map((line, i) => ({
          invoiceId: invoice.id,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxRatePercent: taxRates[i] ?? "0",
          position: i,
        })),
      )
      .returning();
    return { invoice, lines };
  });
  return ok(result);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:integration -- invoicesRepo`
Expected: PASS for all five new tests from Step 1, and the pre-existing tests in this file still
PASS too (they call `createInvoiceFromDeal` with the same four original fields; `taxMode`
defaults to `"exclusive"` and `lineTaxRates` is `undefined` → every line gets `"0"`, so `total` is
unchanged from before).

- [ ] **Step 5: Update `recomputeInvoiceTotal` and its three callers for tax-aware recompute**

Replace the existing `recomputeInvoiceTotal` function with:

```ts
async function recomputeInvoiceTotal(
  db: Db,
  invoiceId: string,
  taxMode: InvoiceTaxMode,
  signal: AbortSignal,
): Promise<void> {
  const lines = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));
  signal.throwIfAborted();
  const { subtotal, taxTotal, total } = computeInvoiceTotals(lines, taxMode);
  await db
    .update(invoices)
    .set({
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      total: total.toFixed(2),
    })
    .where(eq(invoices.id, invoiceId));
}
```

Update its three call sites — `addInvoiceLineItem`, `updateInvoiceLineItem`,
`removeInvoiceLineItem` — each already fetches (or can fetch) the parent invoice via
`assertEditable`, which returns `Result<Invoice, AppError>`. Change:

In `addInvoiceLineItem`, after the existing `const editable = await assertEditable(...)` line,
capture the invoice: `if (!editable.ok) return editable;` stays as-is (it already narrows), and
change the insert to include `taxRatePercent: input.taxRatePercent`:

```ts
  const [row] = await db
    .insert(invoiceLineItems)
    .values({
      invoiceId: input.invoiceId,
      name: product.name,
      quantity: input.quantity,
      unitPrice: input.unitPrice ?? product.price,
      discountPercent: input.discountPercent,
      taxRatePercent: input.taxRatePercent,
      position: (maxPosition ?? -1) + 1,
    })
    .returning();
  if (row === undefined) {
    return err(new AppError(ERROR_IDS.DB_INSERT_FAILED, "insert returned no rows"));
  }
  await recomputeInvoiceTotal(db, input.invoiceId, editable.value.taxMode, signal);
  return ok(row);
```

In `updateInvoiceLineItem`, change the update call and recompute call:

```ts
  const [row] = await db
    .update(invoiceLineItems)
    .set({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discountPercent: input.discountPercent,
      taxRatePercent: input.taxRatePercent,
    })
    .where(eq(invoiceLineItems.id, input.id))
    .returning();
  if (row === undefined) {
    return err(
      new AppError(ERROR_IDS.INVOICE_LINE_NOT_FOUND, "line item not found", { id: input.id }),
    );
  }
  await recomputeInvoiceTotal(db, existing.invoiceId, editable.value.taxMode, signal);
  return ok(row);
```

In `removeInvoiceLineItem`, change the recompute call:

```ts
  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.id, id));
  await recomputeInvoiceTotal(db, existing.invoiceId, editable.value.taxMode, signal);
  return ok(true);
```

- [ ] **Step 6: Write the failing test for line-item mutations keeping tax in sync**

Add:

```ts
it("recomputes tax when a line item's tax rate is updated", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const dealId = await seedDeal(db, user.id, "won");
    await seedProductOnDeal(db, dealId, "100.00", "1");
    const created = await createInvoiceFromDeal(
      db,
      {
        dealId,
        issueDate: "2026-08-31",
        dueDate: null,
        notes: null,
        taxMode: "exclusive",
        billToName: null,
        billToAddress: null,
        billToEmail: null,
        billToTaxId: null,
        lineTaxRates: ["0"],
      },
      sig(),
    );
    if (!created.ok) throw new Error("setup failed");
    const line = created.value.lines[0];
    if (line === undefined) throw new Error("no line");

    const updated = await updateInvoiceLineItem(
      db,
      {
        id: line.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        taxRatePercent: "20",
      },
      sig(),
    );
    expect(updated.ok).toBe(true);

    const reread = await getInvoice(db, created.value.invoice.id, sig());
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.invoice.taxTotal).toBe("20.00");
      expect(reread.value.invoice.total).toBe("120.00");
    }
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test:integration -- invoicesRepo -t "recomputes tax when a line item's tax rate is updated"`
Expected: FAIL — before Step 5's changes this would already pass by coincidence for a non-tax
field, but since `updateInvoiceLineItem` doesn't persist `taxRatePercent` until Step 5's edit, the
column stays at its inserted `"0"` value and `reread.value.invoice.taxTotal` comes back `"0.00"`
instead of `"20.00"`. (Steps 5 and 6 are written together here because they're one cohesive
change — recompute plus its three call sites — but this run confirms the test genuinely exercises
the new code path before moving on.)

- [ ] **Step 8: Run the full suite, verify pass**

Run: `pnpm test:integration -- invoicesRepo`
Expected: PASS, full file.

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/features/invoices/invoicesRepo.ts src/features/invoices/invoicesRepo.test.ts
git commit -m "feat(invoices): compute tax-aware subtotal/total and snapshot the bill-to customer"
```

---

## Task 4: `CreateInvoiceDialog` and the "Generate invoice" flow

**Files:**
- Create: `src/features/invoices/CreateInvoiceDialog.tsx`
- Create: `src/features/invoices/CreateInvoiceDialog.test.tsx`
- Modify: `src/features/invoices/InvoicesPanel.tsx`
- Modify: `src/features/deal-workspace/DealSidebar.tsx`

**Interfaces:**
- Consumes: `createInvoiceAction` from `./actions` (unchanged signature — it already forwards
  whatever matches `createInvoiceInputSchema`); `trpc.products.byDeal.useQuery` (existing);
  `Organization`, `Person` types from `@/db/schema`.
- Produces: `CreateInvoiceDialog({ dealId, org, person, baseCurrency, open, onOpenChange,
  onCreated }): React.ReactNode`. `InvoicesPanel` gains `org: Organization | null`,
  `person: Person | null`, `baseCurrency: string` props (all required, no defaults — every call
  site is updated in this task).

- [ ] **Step 1: Write the failing test for `CreateInvoiceDialog`'s prefill and running totals**

Create `src/features/invoices/CreateInvoiceDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Organization, Person } from "@/db/schema";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

const byDealData = [
  {
    id: "line-1",
    dealId: "deal-1",
    productId: "prod-1",
    name: "Widget",
    quantity: "2",
    unitPrice: "100.00",
    discountPercent: "0",
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    products: {
      byDeal: { useQuery: () => ({ data: byDealData }) },
    },
  },
}));

const { createInvoiceAction } = vi.hoisted(() => ({
  createInvoiceAction: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
}));
vi.mock("./actions", () => ({ createInvoiceAction }));

import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

const org: Organization = {
  id: "org-1",
  name: "Acme Inc",
  address: { street: "1 Main St", city: "Springfield" },
  domain: null,
  industry: null,
  employeeCount: null,
  annualRevenue: null,
  linkedinUrl: null,
  ownerId: "user-1",
  visibilityLevel: "all",
  visibilityGroupId: null,
  visibleToUserIds: [],
  labels: [],
  customFields: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const person: Person = {
  id: "person-1",
  name: "Jane Doe",
  firstName: "Jane",
  lastName: "Doe",
  primaryEmail: "jane@acme.com",
  emails: [],
  phones: [],
  orgId: "org-1",
  ownerId: "user-1",
  visibilityLevel: "all",
  visibilityGroupId: null,
  visibleToUserIds: [],
  labels: [],
  customFields: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

it("prefills customer details from the deal's org and person", () => {
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
  expect(screen.getByLabelText("Customer name")).toHaveValue("Acme Inc");
  expect(screen.getByLabelText("Customer email")).toHaveValue("jane@acme.com");
  expect(screen.getByLabelText("Customer address")).toHaveValue("1 Main St, Springfield");
});

it("shows a running subtotal/tax/total that updates when a line's tax rate changes", async () => {
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
  // base: 2 * 100.00 = 200.00, tax rate starts at 0
  expect(screen.getByTestId("create-invoice-subtotal")).toHaveTextContent("$200.00");
  expect(screen.getByTestId("create-invoice-tax-total")).toHaveTextContent("$0.00");

  const taxInput = screen.getByLabelText("Tax % for Widget");
  taxInput.setAttribute("value", "10");
  taxInput.dispatchEvent(new Event("input", { bubbles: true }));

  await waitFor(() => {
    expect(screen.getByTestId("create-invoice-tax-total")).toHaveTextContent("$20.00");
    expect(screen.getByTestId("create-invoice-total")).toHaveTextContent("$220.00");
  });
});

it("submits the bill-to fields, tax mode, and per-line tax rates on create", async () => {
  const onCreated = vi.fn();
  render(
    <CreateInvoiceDialog
      dealId="deal-1"
      org={org}
      person={person}
      baseCurrency="USD"
      open
      onOpenChange={() => {}}
      onCreated={onCreated}
    />,
  );
  screen.getByRole("button", { name: "Create invoice" }).click();
  await waitFor(() => expect(createInvoiceAction).toHaveBeenCalled());
  const [input] = createInvoiceAction.mock.calls[0] as [Record<string, unknown>];
  expect(input.dealId).toBe("deal-1");
  expect(input.billToName).toBe("Acme Inc");
  expect(input.billToEmail).toBe("jane@acme.com");
  expect(input.taxMode).toBe("exclusive");
  expect(input.lineTaxRates).toEqual(["0"]);
  expect(onCreated).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- CreateInvoiceDialog`
Expected: FAIL — `./CreateInvoiceDialog` does not exist yet.

- [ ] **Step 3: Implement `CreateInvoiceDialog.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { Textarea } from "@/components/ui/Textarea";
import type { Organization, Person } from "@/db/schema";
import type { InvoiceTaxMode } from "@/db/schema/invoices";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createInvoiceAction } from "./actions";

const ADDRESS_KEYS = ["street", "city", "region", "postal", "country"] as const;
function formatAddress(address: Record<string, unknown> | null): string {
  if (address === null) return "";
  const parts = ADDRESS_KEYS.map((key) => address[key]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return parts.join(", ");
}

function money(v: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function lineBase(quantity: string, unitPrice: string): number {
  return Number(quantity) * Number(unitPrice);
}

const TAX_MODE_LABEL: Record<InvoiceTaxMode, string> = {
  exclusive: "Tax exclusive",
  inclusive: "Tax inclusive",
  none: "No tax",
};

export function CreateInvoiceDialog({
  dealId,
  org,
  person,
  baseCurrency,
  open,
  onOpenChange,
  onCreated,
}: {
  dealId: string;
  org: Organization | null;
  person: Person | null;
  baseCurrency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): React.ReactNode {
  const dealProductsQuery = trpc.products.byDeal.useQuery({ dealId });
  const dealLines = dealProductsQuery.data ?? [];

  const [billToName, setBillToName] = useState(org?.name ?? person?.name ?? "");
  const [billToAddress, setBillToAddress] = useState(formatAddress(org?.address ?? null));
  const [billToEmail, setBillToEmail] = useState(person?.primaryEmail ?? "");
  const [billToTaxId, setBillToTaxId] = useState("");
  const [taxMode, setTaxMode] = useState<InvoiceTaxMode>("exclusive");
  const [issueDate, setIssueDate] = useState<string | null>(
    new Date().toISOString().slice(0, 10),
  );
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [taxRates, setTaxRates] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function taxRateFor(lineId: string): string {
    return taxRates[lineId] ?? "0";
  }

  const totals = useMemo(() => {
    let base = 0;
    let tax = 0;
    for (const line of dealLines) {
      const b = lineBase(line.quantity, line.unitPrice) * (1 - Number(line.discountPercent) / 100);
      const rate = Number(taxRateFor(line.id)) / 100;
      const lineTax = taxMode === "none" ? 0 : taxMode === "inclusive" ? b - b / (1 + rate) : b * rate;
      base += b;
      tax += lineTax;
    }
    const subtotal = taxMode === "inclusive" ? base - tax : base;
    const total = taxMode === "inclusive" ? base : base + tax;
    return { subtotal, tax, total };
  }, [dealLines, taxRates, taxMode]);

  async function submit(): Promise<void> {
    setError(null);
    setPending(true);
    const r = await createInvoiceAction(
      {
        dealId,
        issueDate: issueDate ?? new Date().toISOString().slice(0, 10),
        dueDate,
        notes: notes.trim() === "" ? null : notes,
        taxMode,
        billToName: billToName.trim() === "" ? null : billToName,
        billToAddress: billToAddress.trim() === "" ? null : billToAddress,
        billToEmail: billToEmail.trim() === "" ? null : billToEmail,
        billToTaxId: billToTaxId.trim() === "" ? null : billToTaxId,
        lineTaxRates: dealLines.map((l) => taxRateFor(l.id)),
      },
      readCsrfToken(),
    );
    setPending(false);
    if (!r.ok) {
      setError(
        r.error.id === "E_INVOICE_004"
          ? "This deal has no products to invoice yet."
          : "Could not create the invoice.",
      );
      return;
    }
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
        </DialogHeader>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Customer details</h3>
            <Input
              aria-label="Customer name"
              placeholder="Name"
              value={billToName}
              onChange={(e) => setBillToName(e.target.value)}
            />
            <Input
              aria-label="Customer address"
              placeholder="Address"
              value={billToAddress}
              onChange={(e) => setBillToAddress(e.target.value)}
            />
            <Input
              aria-label="Customer email"
              placeholder="Email"
              value={billToEmail}
              onChange={(e) => setBillToEmail(e.target.value)}
            />
            <Input
              aria-label="Customer tax ID"
              placeholder="Tax ID"
              value={billToTaxId}
              onChange={(e) => setBillToTaxId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Invoice details</h3>
            <RadioGroup
              value={taxMode}
              onValueChange={(v) => setTaxMode(v as InvoiceTaxMode)}
              className="flex flex-col gap-1.5"
            >
              {(["exclusive", "inclusive", "none"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={mode} id={`tax-mode-${mode}`} />
                  {TAX_MODE_LABEL[mode]}
                </label>
              ))}
            </RadioGroup>
            <DatePicker value={issueDate} onChange={setIssueDate} ariaLabel="Issue date" />
            <DatePicker value={dueDate} onChange={setDueDate} ariaLabel="Due date" />
            <Textarea
              aria-label="Notes"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              {taxMode !== "none" && <th className="py-2 text-right">Tax %</th>}
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {dealLines.map((line) => (
              <tr key={line.id} className="border-t">
                <td className="py-2">{line.name}</td>
                <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 text-right tabular-nums">
                  {money(Number(line.unitPrice), baseCurrency)}
                </td>
                {taxMode !== "none" && (
                  <td className="py-2 w-24">
                    <Input
                      aria-label={`Tax % for ${line.name}`}
                      value={taxRateFor(line.id)}
                      onChange={(e) =>
                        setTaxRates((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                  </td>
                )}
                <td className="py-2 text-right tabular-nums">
                  {money(
                    lineBase(line.quantity, line.unitPrice) * (1 - Number(line.discountPercent) / 100),
                    baseCurrency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-col items-end gap-1 text-sm">
          <p>
            Subtotal:{" "}
            <span data-testid="create-invoice-subtotal" className="tabular-nums font-medium">
              {money(totals.subtotal, baseCurrency)}
            </span>
          </p>
          {taxMode !== "none" && (
            <p>
              Tax:{" "}
              <span data-testid="create-invoice-tax-total" className="tabular-nums font-medium">
                {money(totals.tax, baseCurrency)}
              </span>
            </p>
          )}
          <p className="font-semibold">
            Total:{" "}
            <span data-testid="create-invoice-total" className="tabular-nums">
              {money(totals.total, baseCurrency)}
            </span>
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || dealLines.length === 0}>
            Create invoice
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- CreateInvoiceDialog`
Expected: PASS, all three tests.

- [ ] **Step 5: Wire `CreateInvoiceDialog` into `InvoicesPanel`**

Replace the full contents of `src/features/invoices/InvoicesPanel.tsx` with:

```tsx
// InvoicesPanel: invoices issued for one deal, shown in the deal Summary sidebar. "Create
// invoice" opens CreateInvoiceDialog, prefilled from the deal's org/person and current products
// (features/products/DealProductsPanel is the source of truth for what gets billed); each row
// links to the printable invoice page.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { Organization, Person } from "@/db/schema";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deleteInvoiceAction, updateInvoiceStatusAction } from "./actions";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceEditDialog } from "./InvoiceEditDialog";

function money(v: string, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

function invoiceNumber(sequenceNumber: number): string {
  return `INV-${String(sequenceNumber).padStart(4, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Issued",
  paid: "Paid",
  canceled: "Canceled",
};

export function InvoicesPanel({
  dealId,
  org,
  person,
  baseCurrency,
}: {
  dealId: string;
  org: Organization | null;
  person: Person | null;
  baseCurrency: string;
}): React.ReactNode {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invoicesQuery = trpc.invoices.listForDeal.useQuery({ dealId });
  const invoices = invoicesQuery.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function refresh(): void {
    void utils.invoices.listForDeal.invalidate({ dealId });
    router.refresh();
  }

  async function markPaid(id: string): Promise<void> {
    const r = await updateInvoiceStatusAction({ id, status: "paid" }, readCsrfToken());
    if (r.ok) refresh();
  }

  async function cancel(id: string): Promise<void> {
    const r = await updateInvoiceStatusAction({ id, status: "canceled" }, readCsrfToken());
    if (r.ok) refresh();
  }

  async function confirmDelete(): Promise<void> {
    const id = pendingDelete;
    if (id === null) return;
    setPendingDelete(null);
    const r = await deleteInvoiceAction({ id }, readCsrfToken());
    if (r.ok) {
      refresh();
      return;
    }
    setError("Could not delete the invoice.");
  }

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-2">
              <a
                href={`/invoices/${inv.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {invoiceNumber(inv.sequenceNumber)}
              </a>
              <span className="tabular-nums">{money(inv.total, baseCurrency)}</span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[inv.status] ?? inv.status}
              </span>
              <span className="inline-flex gap-1">
                {inv.status === "issued" && (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(inv.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void markPaid(inv.id)}>
                      Mark paid
                    </Button>
                    <Button variant="ghost" onClick={() => void cancel(inv.id)}>
                      Cancel
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setPendingDelete(inv.id)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => setCreating(true)}>Generate invoice</Button>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete invoice"
        description="This permanently deletes the invoice and its line items. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
      />
      {editing !== null && (
        <InvoiceEditDialog
          invoiceId={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onChanged={refresh}
          baseCurrency={baseCurrency}
        />
      )}
      <CreateInvoiceDialog
        dealId={dealId}
        org={org}
        person={person}
        baseCurrency={baseCurrency}
        open={creating}
        onOpenChange={setCreating}
        onCreated={refresh}
      />
    </div>
  );
}
```

Note: `InvoiceEditDialog` now takes a `baseCurrency` prop — that's Task 5, done next; this task's
typecheck will fail until Task 5 lands, which is expected and called out in Step 7 below.

- [ ] **Step 6: Thread `org`/`person`/`baseCurrency` from `DealSidebar` into `InvoicesPanel`**

In `src/features/deal-workspace/DealSidebar.tsx`, find:

```tsx
    invoices: (
      <CollapsibleSection key="invoices" title={sections.invoices} showFilter={false}>
        <InvoicesPanel dealId={deal.id} />
      </CollapsibleSection>
    ),
```

Replace with:

```tsx
    invoices: (
      <CollapsibleSection key="invoices" title={sections.invoices} showFilter={false}>
        <InvoicesPanel dealId={deal.id} org={org} person={person} baseCurrency={baseCurrency} />
      </CollapsibleSection>
    ),
```

(`org`, `person`, and `baseCurrency` are already destructured/available in this component's
scope — `org`/`person` from `const { deal, person, org, ... } = workspace;` near the top, and
`baseCurrency` is already a prop `DealSidebar` receives.)

- [ ] **Step 7: Typecheck (expected to still fail until Task 5)**

Run: `pnpm typecheck`
Expected: FAIL — `InvoiceEditDialog` doesn't yet accept `baseCurrency`. This is expected; Task 5
fixes it. Do not attempt to work around it here.

- [ ] **Step 8: Commit**

```bash
git add src/features/invoices/CreateInvoiceDialog.tsx src/features/invoices/CreateInvoiceDialog.test.tsx src/features/invoices/InvoicesPanel.tsx src/features/deal-workspace/DealSidebar.tsx
git commit -m "feat(invoices): add CreateInvoiceDialog with customer/tax fields, replacing the one-click generate button"
```

---

## Task 5: `InvoiceEditDialog` — tax column and totals

**Files:**
- Modify: `src/features/invoices/InvoiceEditDialog.tsx`
- Create: `src/features/invoices/InvoiceEditDialog.test.tsx`

**Interfaces:**
- Consumes: `addInvoiceLineItemAction`/`updateInvoiceLineItemAction`/`removeInvoiceLineItemAction`
  from `./actions` (unchanged signatures — the action layer already forwards whatever matches the
  Task 2 Zod schemas).
- Produces: `InvoiceEditDialog` gains a required `baseCurrency: string` prop (consumed by Task 4's
  `InvoicesPanel`, already wired in Task 4 Step 5).

- [ ] **Step 1: Write the failing test**

Create `src/features/invoices/InvoiceEditDialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./actions", () => ({
  addInvoiceLineItemAction: vi.fn(),
  removeInvoiceLineItemAction: vi.fn(),
  updateInvoiceLineItemAction: vi.fn(),
}));

const invoiceData = {
  invoice: { id: "inv-1", taxMode: "exclusive" },
  lines: [
    {
      id: "line-1",
      invoiceId: "inv-1",
      name: "Widget",
      quantity: "2",
      unitPrice: "100.00",
      discountPercent: "0",
      taxRatePercent: "10",
      position: 0,
    },
  ],
};

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    invoices: { get: { useQuery: () => ({ data: invoiceData, refetch: () => {} }) } },
    products: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

import { InvoiceEditDialog } from "./InvoiceEditDialog";

it("shows a tax % input per line and a subtotal/tax/total footer", () => {
  render(
    <InvoiceEditDialog
      invoiceId="inv-1"
      open
      onOpenChange={() => {}}
      onChanged={() => {}}
      baseCurrency="USD"
    />,
  );
  expect(screen.getByLabelText("Tax percent")).toHaveValue("10");
  // base 200.00, 10% tax = 20.00, total 220.00
  expect(screen.getByText("$200.00")).toBeInTheDocument();
  expect(screen.getByText("$20.00")).toBeInTheDocument();
  expect(screen.getByText("$220.00")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- InvoiceEditDialog`
Expected: FAIL — no "Tax percent" input, no `baseCurrency` prop, footer still shows a single
"Total" with no currency symbol.

- [ ] **Step 3: Update `InvoiceEditDialog.tsx`**

Replace the full contents of `src/features/invoices/InvoiceEditDialog.tsx` with:

```tsx
// InvoiceEditDialog: add/edit/remove line items on an already-issued invoice. Locked once the
// invoice is paid or canceled (assertEditable on the server is the real gate; this dialog only
// opens for an "issued" invoice, per InvoicesPanel).

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  addInvoiceLineItemAction,
  removeInvoiceLineItemAction,
  updateInvoiceLineItemAction,
} from "./actions";

function money(v: string | number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

function lineBase(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

function lineTax(base: number, taxRatePercent: string, taxMode: string): number {
  if (taxMode === "none") return 0;
  const rate = Number(taxRatePercent) / 100;
  if (taxMode === "inclusive") return base - base / (1 + rate);
  return base * rate;
}

export function InvoiceEditDialog({
  invoiceId,
  open,
  onOpenChange,
  onChanged,
  baseCurrency,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  baseCurrency: string;
}): React.ReactNode {
  const invoiceQuery = trpc.invoices.get.useQuery({ id: invoiceId }, { enabled: open });
  const catalogQuery = trpc.products.list.useQuery({ includeArchived: false });
  const invoice = invoiceQuery.data?.invoice;
  const lines = invoiceQuery.data?.lines ?? [];
  const catalog = catalogQuery.data ?? [];
  const taxMode = invoice?.taxMode ?? "exclusive";

  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);

  function refresh(): void {
    void invoiceQuery.refetch();
    onChanged();
  }

  async function addLine(): Promise<void> {
    setError(null);
    if (selectedProductId === "") return;
    const r = await addInvoiceLineItemAction(
      {
        invoiceId,
        productId: selectedProductId,
        quantity,
        discountPercent: "0",
        taxRatePercent: "0",
      },
      readCsrfToken(),
    );
    if (!r.ok) {
      setError("Could not add the item.");
      return;
    }
    setSelectedProductId("");
    setQuantity("1");
    refresh();
  }

  async function updateLine(
    id: string,
    next: { quantity: string; unitPrice: string; discountPercent: string; taxRatePercent: string },
  ): Promise<void> {
    const r = await updateInvoiceLineItemAction({ id, ...next }, readCsrfToken());
    if (!r.ok) {
      setError("Could not update this item.");
      return;
    }
    refresh();
  }

  async function removeLine(id: string): Promise<void> {
    const r = await removeInvoiceLineItemAction({ id }, readCsrfToken());
    if (!r.ok) {
      setError("Could not remove this item.");
      return;
    }
    refresh();
  }

  let subtotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    const base = lineBase(l.quantity, l.unitPrice, l.discountPercent);
    const tax = lineTax(base, l.taxRatePercent, taxMode);
    subtotal += taxMode === "inclusive" ? base - tax : base;
    taxTotal += tax;
  }
  const total = subtotal + taxTotal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit invoice</DialogTitle>
        </DialogHeader>

        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Unit price</th>
                <th className="px-2 py-2">Discount %</th>
                {taxMode !== "none" && <th className="px-2 py-2">Tax %</th>}
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-2 py-2">{l.name}</td>
                  <td className="px-2 py-2 w-20">
                    <Input
                      aria-label="Quantity"
                      value={l.quantity}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: e.target.value,
                          unitPrice: l.unitPrice,
                          discountPercent: l.discountPercent,
                          taxRatePercent: l.taxRatePercent,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 w-28">
                    <Input
                      aria-label="Unit price"
                      value={l.unitPrice}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: l.quantity,
                          unitPrice: e.target.value,
                          discountPercent: l.discountPercent,
                          taxRatePercent: l.taxRatePercent,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2 w-24">
                    <Input
                      aria-label="Discount percent"
                      value={l.discountPercent}
                      onChange={(e) =>
                        void updateLine(l.id, {
                          quantity: l.quantity,
                          unitPrice: l.unitPrice,
                          discountPercent: e.target.value,
                          taxRatePercent: l.taxRatePercent,
                        })
                      }
                    />
                  </td>
                  {taxMode !== "none" && (
                    <td className="px-2 py-2 w-24">
                      <Input
                        aria-label="Tax percent"
                        value={l.taxRatePercent}
                        onChange={(e) =>
                          void updateLine(l.id, {
                            quantity: l.quantity,
                            unitPrice: l.unitPrice,
                            discountPercent: l.discountPercent,
                            taxRatePercent: e.target.value,
                          })
                        }
                      />
                    </td>
                  )}
                  <td className="px-2 py-2 tabular-nums">
                    {money(lineBase(l.quantity, l.unitPrice, l.discountPercent), baseCurrency)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button variant="ghost" onClick={() => void removeLine(l.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td className="px-2 py-2" colSpan={taxMode !== "none" ? 5 : 4}>
                  Subtotal
                </td>
                <td className="px-2 py-2 tabular-nums">{money(subtotal, baseCurrency)}</td>
                <td />
              </tr>
              {taxMode !== "none" && (
                <tr>
                  <td className="px-2 py-2" colSpan={5}>
                    Tax
                  </td>
                  <td className="px-2 py-2 tabular-nums">{money(taxTotal, baseCurrency)}</td>
                  <td />
                </tr>
              )}
              <tr className="border-t font-semibold">
                <td className="px-2 py-2" colSpan={taxMode !== "none" ? 5 : 4}>
                  Total
                </td>
                <td className="px-2 py-2 tabular-nums">{money(total, baseCurrency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <div className="flex items-end gap-2">
          <div className="min-w-48">
            <Select
              ariaLabel="Product"
              value={selectedProductId}
              onChange={setSelectedProductId}
              options={[
                { value: "", label: "Select a product" },
                ...catalog.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${money(p.price, baseCurrency)})`,
                })),
              ]}
            />
          </div>
          <div className="w-20">
            <Input
              aria-label="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <Button onClick={() => void addLine()} disabled={selectedProductId === ""}>
            Add item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- InvoiceEditDialog`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (this resolves the `InvoicesPanel` → `InvoiceEditDialog` prop mismatch from
Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/features/invoices/InvoiceEditDialog.tsx src/features/invoices/InvoiceEditDialog.test.tsx
git commit -m "feat(invoices): add tax % column and subtotal/tax/total footer to InvoiceEditDialog"
```

---

## Task 6: Print page — bill-to snapshot, tax column, currency

**Files:**
- Modify: `src/app/(invoice-print)/invoices/[invoiceId]/page.tsx`

**Interfaces:**
- Consumes: `invoice.billToName`/`billToAddress`/`billToEmail`/`billToTaxId`/`taxMode`/
  `subtotal`/`taxTotal` (Task 1); `line.taxRatePercent` (Task 1); `companySettings.baseCurrency`
  (already selected today — `db.select().from(settings)` selects every column, no query change
  needed).

This page has no test today (it's a server component reading real data at request time; the
repo-level tests in Task 3 already cover the snapshot values it renders). No test is added here —
the behavior under test (tax computation, snapshot persistence) already has coverage at the repo
layer, and this task is a pure rendering change of already-tested data.

- [ ] **Step 1: Replace the full contents of the print page**

```tsx
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { settings } from "@/db/schema/system";
import { getInvoice } from "@/features/invoices/invoicesRepo";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Invoice" };

function money(v: string, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
}

function lineTotal(quantity: string, unitPrice: string, discountPercent: string): number {
  return Number(quantity) * Number(unitPrice) * (1 - Number(discountPercent) / 100);
}

function invoiceNumber(sequenceNumber: number): string {
  return `INV-${String(sequenceNumber).padStart(4, "0")}`;
}

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}): Promise<ReactNode> {
  const { invoiceId } = await params;
  const result = await getInvoice(db, invoiceId, AbortSignal.timeout(5000));
  if (!result.ok) notFound();
  const { invoice, lines } = result.value;

  const [deal] = await db.select().from(deals).where(eq(deals.id, invoice.dealId));
  const [companySettings] = await db.select().from(settings).where(eq(settings.id, true));
  const currency = companySettings?.baseCurrency ?? "USD";

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          {companySettings?.invoiceHeaderImageUrl != null && (
            // biome-ignore lint/performance/noImgElement: uploaded object served from our own API.
            <img
              src={companySettings.invoiceHeaderImageUrl}
              alt=""
              className="h-14 max-w-40 object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold">
              {companySettings?.companyName ?? "Warpdrive"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Invoice {invoiceNumber(invoice.sequenceNumber)}
            </p>
          </div>
        </div>
        <PrintButton />
      </div>

      {companySettings?.invoiceHeaderText != null && companySettings.invoiceHeaderText !== "" && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {companySettings.invoiceHeaderText}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Billed to</p>
          <p className="font-medium">{invoice.billToName ?? "—"}</p>
          {invoice.billToAddress != null && (
            <p className="text-muted-foreground">{invoice.billToAddress}</p>
          )}
          {invoice.billToEmail != null && (
            <p className="text-muted-foreground">{invoice.billToEmail}</p>
          )}
          {invoice.billToTaxId != null && (
            <p className="text-muted-foreground">Tax ID: {invoice.billToTaxId}</p>
          )}
          {deal !== undefined && <p className="text-muted-foreground">{deal.title}</p>}
        </div>
        <div className="text-right">
          <p>
            <span className="text-muted-foreground">Issue date: </span>
            {invoice.issueDate}
          </p>
          {invoice.dueDate !== null && (
            <p>
              <span className="text-muted-foreground">Due date: </span>
              {invoice.dueDate}
            </p>
          )}
          <p className="capitalize">
            <span className="text-muted-foreground">Status: </span>
            {invoice.status}
          </p>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            <th className="py-2 text-right">Discount</th>
            {invoice.taxMode !== "none" && <th className="py-2 text-right">Tax</th>}
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2">{line.name}</td>
              <td className="py-2 text-right tabular-nums">{line.quantity}</td>
              <td className="py-2 text-right tabular-nums">{money(line.unitPrice, currency)}</td>
              <td className="py-2 text-right tabular-nums">{line.discountPercent}%</td>
              {invoice.taxMode !== "none" && (
                <td className="py-2 text-right tabular-nums">{line.taxRatePercent}%</td>
              )}
              <td className="py-2 text-right tabular-nums">
                {money(lineTotal(line.quantity, line.unitPrice, line.discountPercent).toFixed(2), currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col items-end gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Subtotal: </span>
          {money(invoice.subtotal, currency)}
        </p>
        {invoice.taxMode !== "none" && (
          <p>
            <span className="text-muted-foreground">Tax: </span>
            {money(invoice.taxTotal, currency)}
          </p>
        )}
        <p className="text-base font-semibold">
          <span className="text-muted-foreground font-normal">Total: </span>
          {money(invoice.total, currency)}
        </p>
      </div>

      {invoice.notes !== null && invoice.notes !== "" && (
        <div className="text-sm">
          <p className="text-muted-foreground">Notes</p>
          <p>{invoice.notes}</p>
        </div>
      )}

      {(companySettings?.invoiceFooterText != null && companySettings.invoiceFooterText !== "") ||
      companySettings?.invoiceFooterImageUrl != null ? (
        <div className="space-y-2 border-t pt-4">
          {companySettings.invoiceFooterImageUrl != null && (
            // biome-ignore lint/performance/noImgElement: uploaded object served from our own API.
            <img
              src={companySettings.invoiceFooterImageUrl}
              alt=""
              className="h-14 max-w-40 object-contain"
            />
          )}
          {companySettings.invoiceFooterText != null &&
            companySettings.invoiceFooterText !== "" && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {companySettings.invoiceFooterText}
              </p>
            )}
        </div>
      ) : null}
    </div>
  );
}
```

Note: the `organizations`/`persons` imports and joins are removed entirely — `billedTo` is gone,
replaced by the `invoice.billTo*` snapshot fields. This is the fix for the live-join bug the spec
called out.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev` (or the project's existing dev-server workflow), open a deal with products, use
"Generate invoice" to create one through the new dialog, open its printable page
(`/invoices/<id>`), and confirm: bill-to block shows the snapshotted name/address/email, the
line-item table shows a Tax % column when tax mode isn't "none", and the Subtotal/Tax/Total block
matches the numbers entered in the dialog. This is the step called out in CLAUDE.md's "For UI or
frontend changes... use the feature in a browser before reporting complete" — do not skip it.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(invoice-print)/invoices/[invoiceId]/page.tsx"
git commit -m "feat(invoices): render the bill-to snapshot, tax column, and subtotal/tax/total on the printed invoice"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:unit && pnpm test:integration`
Expected: PASS, no regressions in `DealSidebar.*.test.tsx` (which now render `InvoicesPanel` with
the new required props via the real `DealSidebar` call site) or any other suite touching invoices.

- [ ] **Step 2: Typecheck and lint the whole repo**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Apply the migration to the local dev database**

Run: `pnpm db:migrate`
Expected: the new `invoice_tax_mode` enum and columns appear in the local Postgres instance.

- [ ] **Step 4: Final manual smoke test**

Repeat Task 6 Step 3's manual check end-to-end once more against the fully migrated dev database
(not just the test DB), including: creating an invoice with `taxMode: "inclusive"` to confirm the
subtotal is correctly backed out of tax-included prices, editing a line item's tax rate on an
already-issued invoice via `InvoiceEditDialog` and confirming the printed page updates, and
deleting/marking-paid an invoice to confirm those existing flows are untouched.
