/**
 * /api/settings/invoice-image/[kind]: inline header/footer invoice image serving.
 *
 * Mirrors /api/users/[userId]/avatar/route.ts: an authenticated-actor gate only (these images
 * appear on every printed invoice, visible to anyone who can view that invoice), a stable URL
 * with a ?v= cache-buster, 404 on a missing object.
 */

import type { NextRequest } from "next/server";
import { makeStorageClient } from "@/features/files/storage";
import { resolveInvoiceImageBytes } from "@/features/settings/invoiceImageServe";
import { isInvoiceImageKind } from "@/features/settings/invoiceImageStorage";
import { createContext } from "@/server/trpc/context";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string }> },
): Promise<Response> {
  const { kind } = await ctx.params;
  const { actor } = await createContext();
  if (actor === null) return new Response("Não autorizado", { status: 401 });
  if (!isInvoiceImageKind(kind)) return new Response("Não encontrado", { status: 404 });

  const signal = AbortSignal.timeout(10_000);
  const r = await resolveInvoiceImageBytes(makeStorageClient(), kind, signal);
  if (!r.ok) return new Response("Não encontrado", { status: 404 });

  return new Response(new Uint8Array(r.value.bytes), {
    headers: {
      "content-type": r.value.contentType,
      "cache-control": "private, max-age=86400, immutable",
    },
  });
}
