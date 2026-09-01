import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { organizations } from "@/db/schema/organizations";
import { persons } from "@/db/schema/persons";
import { settings } from "@/db/schema/system";
import { getInvoice } from "@/features/invoices/invoicesRepo";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Invoice" };

function money(v: string): string {
  return new Intl.NumberFormat(undefined, {
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
  const org =
    deal?.orgId != null
      ? (await db.select().from(organizations).where(eq(organizations.id, deal.orgId)))[0]
      : undefined;
  const person =
    deal?.personId != null
      ? (await db.select().from(persons).where(eq(persons.id, deal.personId)))[0]
      : undefined;

  const billedTo = org?.name ?? person?.name ?? "—";

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
          <p className="font-medium">{billedTo}</p>
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
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-2">{line.name}</td>
              <td className="py-2 text-right tabular-nums">{line.quantity}</td>
              <td className="py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
              <td className="py-2 text-right tabular-nums">{line.discountPercent}%</td>
              <td className="py-2 text-right tabular-nums">
                {money(lineTotal(line.quantity, line.unitPrice, line.discountPercent).toFixed(2))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="py-2" colSpan={4}>
              Total
            </td>
            <td className="py-2 text-right tabular-nums">{money(invoice.total)}</td>
          </tr>
        </tfoot>
      </table>

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
