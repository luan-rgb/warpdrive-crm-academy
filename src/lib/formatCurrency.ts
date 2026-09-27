// Shared money formatter for compact UI surfaces (board cards, column totals). Deal values
// are stored as decimal strings; the board shows whole-currency amounts for a clean read.
// Locale is pinned to pt-BR so output is deterministic regardless of the runtime locale.
export function formatCurrency(value: string | number, currency = "BRL"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

// Same, with cents: for unit prices, line items and invoices, where rounding to whole reais would
// misstate the amount.
export function formatCurrencyExact(value: string | number, currency = "BRL"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
