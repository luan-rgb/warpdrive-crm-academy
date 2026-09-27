// Server settings for the mail providers students use most, so the IMAP/SMTP form can fill them in
// from the address domain. Values from each provider's published help pages. Gmail and Outlook
// also have one-click OAuth buttons; the Gmail preset is for students who prefer an app password.
export interface ImapPreset {
  label: string;
  domains: readonly string[];
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  // Shown under the form: most of these reject the normal password and need an app password.
  appPasswordHint: boolean;
}

export const IMAP_PRESETS: readonly ImapPreset[] = [
  {
    label: "Gmail (senha de app)",
    domains: ["gmail.com", "googlemail.com"],
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    appPasswordHint: true,
  },
  {
    label: "Yahoo",
    domains: ["yahoo.com", "yahoo.com.br", "ymail.com"],
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    appPasswordHint: true,
  },
  {
    label: "iCloud",
    domains: ["icloud.com", "me.com", "mac.com"],
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    appPasswordHint: true,
  },
  {
    label: "Zoho",
    domains: ["zoho.com", "zohomail.com"],
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    appPasswordHint: false,
  },
  {
    label: "UOL",
    domains: ["uol.com.br", "bol.com.br"],
    imap: { host: "imap.uol.com.br", port: 993, secure: true },
    smtp: { host: "smtps.uol.com.br", port: 587, secure: false },
    appPasswordHint: false,
  },
  {
    label: "Terra",
    domains: ["terra.com.br"],
    imap: { host: "imap.terra.com.br", port: 993, secure: true },
    smtp: { host: "smtp.terra.com.br", port: 587, secure: false },
    appPasswordHint: false,
  },
  {
    label: "Hostinger",
    domains: [],
    imap: { host: "imap.hostinger.com", port: 993, secure: true },
    smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
    appPasswordHint: false,
  },
  {
    label: "Locaweb",
    domains: [],
    imap: { host: "email-ssl.com.br", port: 993, secure: true },
    smtp: { host: "email-ssl.com.br", port: 465, secure: true },
    appPasswordHint: false,
  },
  {
    label: "KingHost",
    domains: [],
    imap: { host: "imap.kinghost.net", port: 993, secure: true },
    smtp: { host: "smtp.kinghost.net", port: 465, secure: true },
    appPasswordHint: false,
  },
];

export function presetForAddress(email: string): ImapPreset | undefined {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return IMAP_PRESETS.find((p) => p.domains.includes(domain));
}
