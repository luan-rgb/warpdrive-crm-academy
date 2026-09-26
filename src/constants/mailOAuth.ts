// OAuth endpoints and scopes for the free direct mailbox connections (Gmail, Outlook). The
// mail-oauth-relay service (mail-oauth-relay/) mirrors these values; keep them in sync.
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export const GMAIL_MAILBOX_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

// offline_access is what makes Microsoft return a refresh token at all.
export const OUTLOOK_MAILBOX_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
] as const;
