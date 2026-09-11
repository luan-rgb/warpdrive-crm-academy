// Parses a number as a pt-BR user would type it: comma as the decimal separator, "." as an
// optional thousands separator (matching what formatCurrency/Intl.NumberFormat("pt-BR") displays).
// "10.000,50" -> 10000.5, "10000,5" -> 10000.5, "10000" -> 10000. Returns null for blank or
// unparseable input, mirroring the plain-Number() null contract these editors already relied on.
export function parseLocaleNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}
