// InvoiceImageUpload: upload/remove control for the invoice header or footer image (a logo, a
// signature/stamp). Same presigned-upload handshake as identity/avatar/AvatarUpload.tsx, keyed
// by kind instead of a user id.

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  confirmInvoiceImageUploadAction,
  removeInvoiceImageAction,
  requestInvoiceImageUploadAction,
} from "./invoiceImageActions";
import {
  INVOICE_IMAGE_CONTENT_TYPES,
  INVOICE_IMAGE_MAX_BYTES,
  type InvoiceImageKind,
  isInvoiceImageContentType,
} from "./invoiceImageStorage";

interface Props {
  kind: InvoiceImageKind;
  label: string;
  imageUrl: string | null;
}

export function InvoiceImageUpload({ kind, label, imageUrl }: Props): React.ReactNode {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<string | null> {
    if (!isInvoiceImageContentType(file.type)) {
      return "Escolha uma imagem PNG, JPEG, WebP ou GIF.";
    }
    if (file.size > INVOICE_IMAGE_MAX_BYTES) return "Essa imagem é muito grande (máx. 2 MB).";

    const csrf = readCsrfToken();
    const requested = await requestInvoiceImageUploadAction(
      kind,
      { contentType: file.type, size: file.size },
      csrf,
    );
    if (!requested.ok) return "Não foi possível enviar a imagem.";

    const form = new FormData();
    for (const [k, v] of Object.entries(requested.value.post.fields)) form.append(k, v);
    form.append("file", file);
    const uploaded = await fetch(requested.value.post.url, { method: "POST", body: form });
    if (!uploaded.ok) return "Não foi possível enviar a imagem.";

    const confirmed = await confirmInvoiceImageUploadAction(kind, csrf);
    if (!confirmed.ok) return "Não foi possível enviar a imagem.";
    return null;
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (file === undefined) return;
    setError(null);
    setBusy(true);
    try {
      const message = await upload(file);
      if (message !== null) {
        setError(message);
        return;
      }
      router.refresh();
    } catch {
      setError("Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  }

  async function remove(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const r = await removeInvoiceImageAction(kind, readCsrfToken());
      if (!r.ok) {
        setError("Não foi possível remover a imagem.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {imageUrl !== null ? (
          // biome-ignore lint/performance/noImgElement: uploaded object served from our own API, not an optimizable static asset.
          <img
            src={imageUrl}
            alt=""
            className="h-12 max-w-40 rounded border object-contain bg-white"
          />
        ) : (
          <div className="flex h-12 w-40 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
            Sem imagem
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="min-h-10 px-3"
            >
              {imageUrl !== null ? "Trocar imagem" : "Enviar imagem"}
            </Button>
            {imageUrl !== null && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove()}
                className="min-h-10 px-3 text-muted-foreground hover:text-foreground"
              >
                Remove
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">PNG, JPEG, WebP ou GIF, até 2 MB.</span>
        </div>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={INVOICE_IMAGE_CONTENT_TYPES.join(",")}
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
