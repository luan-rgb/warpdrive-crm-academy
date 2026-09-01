// Client-safe invoice-branding-image constants + key builders. NO env import, mirrors
// identity/avatar/avatarStorage.ts: two global (not per-user) image slots, one per invoice
// section. Content-type allowlist and size cap are the avatar ones, reused as-is.

export {
  AVATAR_CONTENT_TYPES as INVOICE_IMAGE_CONTENT_TYPES,
  AVATAR_MAX_BYTES as INVOICE_IMAGE_MAX_BYTES,
  isAvatarContentType as isInvoiceImageContentType,
} from "@/features/identity/avatar/avatarStorage";

export const INVOICE_IMAGE_KINDS = ["header", "footer"] as const;
export type InvoiceImageKind = (typeof INVOICE_IMAGE_KINDS)[number];

export function isInvoiceImageKind(v: string): v is InvoiceImageKind {
  return (INVOICE_IMAGE_KINDS as readonly string[]).includes(v);
}

// One stable upload key per kind: like the avatar upload key, an abandoned upload is simply
// overwritten by the next attempt and deleted on confirm.
export function invoiceImageUploadKey(kind: InvoiceImageKind): string {
  return `settings/invoice-image-uploads/${kind}`;
}

// One stable confirmed object per kind.
export function invoiceImageObjectKey(kind: InvoiceImageKind): string {
  return `settings/invoice-images/${kind}`;
}

// Stable serve URL stored in settings.invoice{Header,Footer}ImageUrl. The version query param
// busts the browser cache on replacement, same as avatarPublicUrl.
export function invoiceImagePublicUrl(kind: InvoiceImageKind, version: string): string {
  return `/api/settings/invoice-image/${kind}?v=${version}`;
}
