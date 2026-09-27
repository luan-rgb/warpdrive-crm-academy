"use server";

import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { makeStorageClient, type PresignedPost } from "@/features/files/storage";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { err, type Result } from "@/types/result";
import { requireManage } from "./adminGate";
import {
  confirmInvoiceImageUpload,
  removeInvoiceImage,
  requestInvoiceImageUpload,
} from "./invoiceImageService";
import { type InvoiceImageKind, isInvoiceImageKind } from "./invoiceImageStorage";

// Same gate as the other settings actions (permissions.manage or admin), not per-user auth: these
// are settings singletons an admin/manager configures once for everyone, unlike an avatar.
async function gate(csrfToken: string | null): Promise<Result<true, AppError>> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return err(new AppError(ERROR_IDS.PERM_DENIED, "csrf failed", {}));
  const { actor } = await createContext();
  const allowed = requireManage(actor);
  if (!allowed.ok) return err(new AppError(ERROR_IDS.PERM_DENIED, allowed.error.id, {}));
  return { ok: true, value: true };
}

export async function requestInvoiceImageUploadAction(
  kind: InvoiceImageKind,
  input: { contentType: string; size: number },
  csrfToken: string | null = null,
): Promise<Result<{ post: PresignedPost }, AppError>> {
  const g = await gate(csrfToken);
  if (!g.ok) return g;
  // The kind names a storage key: a client-sent value must be one of the known kinds.
  if (!isInvoiceImageKind(kind)) {
    return err(new AppError(ERROR_IDS.INVOICE_IMAGE_INVALID, "unknown invoice image kind", {}));
  }
  return requestInvoiceImageUpload(makeStorageClient(), kind, input, SIG());
}

export async function confirmInvoiceImageUploadAction(
  kind: InvoiceImageKind,
  csrfToken: string | null = null,
): Promise<Result<{ url: string }, AppError>> {
  const g = await gate(csrfToken);
  if (!g.ok) return g;
  // The kind names a storage key: a client-sent value must be one of the known kinds.
  if (!isInvoiceImageKind(kind)) {
    return err(new AppError(ERROR_IDS.INVOICE_IMAGE_INVALID, "unknown invoice image kind", {}));
  }
  return confirmInvoiceImageUpload(db, makeStorageClient(), kind, SIG());
}

export async function removeInvoiceImageAction(
  kind: InvoiceImageKind,
  csrfToken: string | null = null,
): Promise<Result<{ removed: true }, AppError>> {
  const g = await gate(csrfToken);
  if (!g.ok) return g;
  // The kind names a storage key: a client-sent value must be one of the known kinds.
  if (!isInvoiceImageKind(kind)) {
    return err(new AppError(ERROR_IDS.INVOICE_IMAGE_INVALID, "unknown invoice image kind", {}));
  }
  return removeInvoiceImage(db, makeStorageClient(), kind, SIG());
}
