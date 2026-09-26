// Phone/email type labels. The stored value stays the original English key (existing contacts
// already hold "Work", "Mobile"...), and only the text on screen is Portuguese.
const CONTACT_POINT_LABELS: Record<string, string> = {
  Work: "Trabalho",
  Mobile: "Celular",
  Home: "Residencial",
  Other: "Outro",
};

export function contactPointLabel(key: string): string {
  return CONTACT_POINT_LABELS[key] ?? key;
}
