// Inbox list date, formatted like Pipedrive's Sales Inbox: a short "MMM D" for the current year
// (e.g. "2 de jul.") and "D de MMM. de YYYY" for older messages, instead of a verbose locale datetime
// ("7/1/2026, 10:14:50 AM"). `now` is injectable so the year boundary is testable.
export function formatInboxListDate(iso: string | null, now: Date = new Date()): string {
  if (iso === null || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Reader message-header date, formatted like Pipedrive's thread view ("June 11 (29 days ago)"):
// full month + day, an omitted year for the current year, and a relative age, instead of a raw
// locale datetime with seconds ("7/11/2026, 12:14:47 AM"). `now` is injectable for testing.
export function formatReaderDate(iso: string | null, now: Date = new Date()): string {
  if (iso === null || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString("pt-BR", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const startOfDay = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const rel = diffDays <= 0 ? "hoje" : diffDays === 1 ? "ontem" : `há ${diffDays} dias`;
  return `${datePart} (${rel})`;
}

// Timeline card date, formatted like Pipedrive's deal history ("5:04 PM (a minute ago)"): the
// time of day, then an age that stays useful at every scale. `now` is injectable for testing.
export function formatTimelineEmailDate(iso: string | null, now: Date = new Date()): string {
  if (iso === null || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("pt-BR", { hour: "numeric", minute: "2-digit" });
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (mins < 1) return `${time} (agora mesmo)`;
  if (mins === 1) return `${time} (há um minuto)`;
  if (mins < 60) return `${time} (há ${mins} minutos)`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${time} (há ${hours} ${hours === 1 ? "hora" : "horas"})`;
  const days = Math.round(hours / 24);
  return `${time} (há ${days} ${days === 1 ? "dia" : "dias"})`;
}
