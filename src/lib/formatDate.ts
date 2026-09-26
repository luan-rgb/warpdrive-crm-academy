// Readable date for a YYYY-MM-DD string: "Jul 16, 2026" (PD shows a readable date, not MM/DD/YYYY).
// Parsed as a local date (not UTC) so the day never shifts by a timezone off-by-one.
export function formatMediumDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return new Date(y as number, (m as number) - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Date and time for the Brazilian UI: "20/09/2026, 14:05". Pinned to pt-BR rather than the
// browser locale so every student sees the same format.
export function formatDateTimePtBr(d: Date): string {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
