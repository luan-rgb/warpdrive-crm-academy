import type { AppError } from "@/constants/errorIds";
import type { StorageClient } from "@/features/files/storage";
import { ok, type Result } from "@/types/result";
import { type InvoiceImageKind, invoiceImageObjectKey } from "./invoiceImageStorage";

// Fetch a confirmed header/footer image's bytes + content type for inline serving. Mirrors
// identity/avatar/avatarServe.ts's resolveAvatarBytes, keyed by kind instead of a user id.
export async function resolveInvoiceImageBytes(
  storage: StorageClient,
  kind: InvoiceImageKind,
  signal: AbortSignal,
): Promise<Result<{ bytes: Buffer; contentType: string }, AppError>> {
  signal.throwIfAborted();
  const key = invoiceImageObjectKey(kind);
  const head = await storage.headObject(key, signal);
  if (!head.ok) return head;
  signal.throwIfAborted();

  const bytes = await storage.getObjectBytes(key, signal);
  if (!bytes.ok) return bytes;
  return ok({
    bytes: bytes.value,
    contentType: head.value.contentType ?? "application/octet-stream",
  });
}
