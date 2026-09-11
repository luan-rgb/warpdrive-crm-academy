import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { settings } from "@/db/schema/system";
import { getInvoice } from "@/features/invoices/invoicesRepo";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Fatura" };

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
              Fatura {invoiceNumber(invoice.sequenceNumber)}
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
          <p className="text-muted-foreground">Faturado para</p>
          <p className="font-medium">{invoice.billToName ?? "—"}</p>
          {invoice.billToAddress != null && (
            <p className="text-muted-foreground">{invoice.billToAddress}</p>
          )}
          {invoice.billToEmail != null && (
            <p className="text-muted-foreground">{invoice.billToEmail}</p>
          )}
          {invoice.billToTaxId != null && (
            <p className="text-muted-foreground">CNPJ/CPF: {invoice.billToTaxId}</p>
          )}
          {deal !== undefined && <p className="text-muted-foreground">{deal.title}</p>}
        </div>
        <div className="text-right">
          <p>
            <span className="text-muted-foreground">Data de emissão: </span>
            {invoice.issueDate}
          </p>
          {invoice.dueDate !== null && (
            <p>
              <span className="text-muted-foreground">Data de vencimento: </span>
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
            <th className="py-2 text-right">Qtd.</th>
            <th className="py-2 text-right">Preço unitário</th>
            <th className="py-2 text-right">Desconto</th>
            {invoice.taxMode !== "none" && <th className="py-2 text-right">Imposto</th>}
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
                {money(
                  lineTotal(line.quantity, line.unitPrice, line.discountPercent).toFixed(2),
                  currency,
                )}
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
            <span className="text-muted-foreground">Imposto: </span>
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
          <p className="text-muted-foreground">Notas</p>
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
