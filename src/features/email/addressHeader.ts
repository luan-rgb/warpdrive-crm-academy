// Gmail's "Name <email>" header token, used when a provider hands us already-decoded participants
// and we rebuild headers for parseGmailMessage. Always quote a present name: splitAddresses
// (mimeParse.ts) only tears an unquoted comma apart, so quoting costs nothing for a plain name and
// is required for one that itself contains a comma ("Doe, John").
export function toHeaderToken(p: { name?: string | null; email: string }): string {
  if (p.name === undefined || p.name === null || p.name.length === 0) return p.email;
  return `"${p.name.replace(/"/g, '\\"')}" <${p.email}>`;
}

export function toAddressListHeader(
  participants: { name?: string | null; email: string }[],
): string {
  return participants.map(toHeaderToken).join(", ");
}
