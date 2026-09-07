// Minimal {{deal.field}} placeholder substitution for automation message/email templates.
// Not a templating library dependency (YAGNI): three known placeholders don't need one.
export function renderTemplate(
  template: string,
  deal: { title: string; value: string | null; ownerName: string },
): string {
  return template
    .replaceAll("{{deal.title}}", deal.title)
    .replaceAll("{{deal.value}}", deal.value ?? "")
    .replaceAll("{{deal.owner}}", deal.ownerName);
}
