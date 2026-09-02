-- data backfill for pre-migration-0077 invoices
-- 0077 added subtotal/tax_total/tax_mode/bill_to_* to "invoices" defaulted to '0'/'exclusive'/NULL.
-- Those defaults are correct for the columns but wrong for rows that existed before the
-- migration ran: an already-issued invoice's "total" is still correct, but its new subtotal/
-- tax_total/bill_to_name columns are meaningless zeros/blanks. Since nothing in the app ever
-- recomputes a paid/canceled invoice's totals again, that would be permanent.
--
-- The WHERE clauses target only rows still sitting at their just-migrated defaults (tax_mode =
-- 'exclusive' AND tax_total = '0' for the totals backfill; bill_to_name IS NULL for the
-- bill-to backfill), not any invoice a user may have already created through the new UI in the
-- window between the 0077 migration and this one.
UPDATE "invoices" SET "subtotal" = "total", "tax_mode" = 'none' WHERE "tax_mode" = 'exclusive' AND "tax_total" = '0';
--> statement-breakpoint
UPDATE "invoices" i
SET "bill_to_name" = COALESCE(o.name, p.name),
    "bill_to_email" = p.primary_email
FROM "deals" d
LEFT JOIN "organizations" o ON o.id = d.org_id
LEFT JOIN "persons" p ON p.id = d.person_id
WHERE d.id = i.deal_id AND i."bill_to_name" IS NULL;
