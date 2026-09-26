const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

// Format a "YYYY-MM-DD" ISO date as "Seg 29" (weekday + day-of-month), matching
// Pipedrive's calendar column headers. Parses the parts directly and computes
// the weekday in UTC so the result never drifts with the runtime timezone.
export function isoToDayHeading(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return `${WEEKDAYS[weekday] ?? "?"} ${d ?? ""}`.trim();
}

const WEEKDAYS_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

// Spoken form of a day column, e.g. "Segunda-feira, 31 de agosto de 2026". The visible heading is abbreviated to
// fit the column; a screen reader announcing "Seg 31" seven times says very little about which day
// each group of activities belongs to.
export function isoToDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  const month = MONTHS_LONG[(m ?? 1) - 1] ?? "";
  return `${WEEKDAYS_LONG[weekday] ?? "?"}, ${d ?? ""} de ${month} de ${y ?? ""}`.trim();
}
