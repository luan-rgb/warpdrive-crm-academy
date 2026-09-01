import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema/system";
import type { PresignedPost, StorageClient } from "@/features/files/storage";
import { sniffImageType } from "@/features/identity/avatar/imageSniff";
import { err, ok, type Result } from "@/types/result";
import {
  INVOICE_IMAGE_MAX_BYTES,
  type InvoiceImageKind,
  invoiceImageObjectKey,
  invoiceImagePublicUrl,
  invoiceImageUploadKey,
  isInvoiceImageContentType,
} from "./invoiceImageStorage";

const requestInput = z.object({
  contentType: z.string(),
  size: z.number().int().positive().max(INVOICE_IMAGE_MAX_BYTES),
});

function invalid(message: string): AppError {
  return new AppError(ERROR_IDS.INVOICE_IMAGE_INVALID, message, {});
}

// Mirrors identity/avatar/avatarService.ts's request/confirm/remove shape, keyed by a fixed
// kind ("header" | "footer") instead of a user id: these are settings singletons, not per-user.

export async function requestInvoiceImageUpload(
  storage: StorageClient,
  kind: InvoiceImageKind,
  input: { contentType: string; size: number },
  signal: AbortSignal,
): Promise<Result<{ post: PresignedPost }, AppError>> {
  signal.throwIfAborted();
  const parsed = requestInput.safeParse(input);
  if (!parsed.success || !isInvoiceImageContentType(parsed.data.contentType)) {
    return err(invalid("invalid invoice image upload input"));
  }
  const key = invoiceImageUploadKey(kind);
  const post = await storage.presignPost(
    key,
    parsed.data.contentType,
    signal,
    INVOICE_IMAGE_MAX_BYTES,
  );
  if (!post.ok) return post;
  return ok({ post: post.value });
}

// Validates the uploaded object's real bytes before promoting it, same reasoning as
// confirmAvatarUpload: the presigned-POST policy only pins the CLIENT-declared content type.
export async function confirmInvoiceImageUpload(
  db: Db,
  storage: StorageClient,
  kind: InvoiceImageKind,
  signal: AbortSignal,
): Promise<Result<{ url: string }, AppError>> {
  signal.throwIfAborted();
  const uploadKey = invoiceImageUploadKey(kind);
  const destKey = invoiceImageObjectKey(kind);

  const bytes = await storage.getObjectBytes(uploadKey, signal);
  if (!bytes.ok) return bytes;
  signal.throwIfAborted();

  if (
    bytes.value.length === 0 ||
    bytes.value.length > INVOICE_IMAGE_MAX_BYTES ||
    sniffImageType(bytes.value) === null
  ) {
    await storage.deleteObject(uploadKey, signal);
    return err(invalid("uploaded object is not a valid image"));
  }

  const copied = await storage.copyObject(uploadKey, destKey, signal);
  if (!copied.ok) return copied;
  signal.throwIfAborted();

  const url = invoiceImagePublicUrl(kind, randomUUID());
  const column = kind === "header" ? "invoiceHeaderImageUrl" : "invoiceFooterImageUrl";
  await db
    .update(settings)
    .set({ [column]: url })
    .where(eq(settings.id, true));
  signal.throwIfAborted();

  await storage.deleteObject(uploadKey, signal);
  return ok({ url });
}

export async function removeInvoiceImage(
  db: Db,
  storage: StorageClient,
  kind: InvoiceImageKind,
  signal: AbortSignal,
): Promise<Result<{ removed: true }, AppError>> {
  signal.throwIfAborted();
  const column = kind === "header" ? "invoiceHeaderImageUrl" : "invoiceFooterImageUrl";
  await db
    .update(settings)
    .set({ [column]: null })
    .where(eq(settings.id, true));
  signal.throwIfAborted();
  await storage.deleteObject(invoiceImageObjectKey(kind), signal);
  return ok({ removed: true });
}
