import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema/deals";
import { isPublicAddress } from "@/lib/net/publicAddress";
import type { ActionOutcome, DealRef } from "./actionOutcome";
import { failed, succeeded } from "./actionOutcome";

const TIMEOUT_MS = 10_000;

export interface WebhookDeps {
  lookup: (host: string) => Promise<{ address: string; family: number }[]>;
  fetch: typeof fetch;
  loadDeal: (dealId: string) => Promise<Record<string, unknown> | null>;
}

export function defaultWebhookDeps(db: Db): WebhookDeps {
  return {
    lookup: (host) => dnsLookup(host, { all: true }),
    fetch,
    loadDeal: async (dealId) => {
      const [d] = await db
        .select({
          id: deals.id,
          title: deals.title,
          value: deals.value,
          status: deals.status,
          pipelineId: deals.pipelineId,
          stageId: deals.stageId,
          ownerId: deals.ownerId,
          personId: deals.personId,
          orgId: deals.orgId,
          expectedCloseDate: deals.expectedCloseDate,
        })
        .from(deals)
        .where(eq(deals.id, dealId));
      return d ?? null;
    },
  };
}

// POSTs the deal as JSON to the rule's URL (the free way to reach Zapier/Make/n8n or any custom
// system). The host is resolved first and refused when any address is internal; redirects are
// not followed, since a redirect could point back inside. A small residual DNS-rebinding window
// between this check and fetch's own resolution remains; the timeout bounds any abuse of it.
export async function runWebhook(
  deal: DealRef,
  config: Record<string, unknown>,
  signal: AbortSignal,
  deps: WebhookDeps,
): Promise<ActionOutcome> {
  signal.throwIfAborted();
  let url: URL;
  try {
    url = new URL(typeof config.url === "string" ? config.url : "");
  } catch {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "endereço do webhook inválido");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "o webhook precisa usar http ou https");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses =
    isIP(host) !== 0
      ? [{ address: host, family: isIP(host) }]
      : await deps.lookup(host).catch(() => []);
  signal.throwIfAborted();
  if (addresses.length === 0) {
    return failed(
      ERROR_IDS.AUTOMATION_INPUT_INVALID,
      "não foi possível encontrar o endereço do webhook",
    );
  }
  if (!addresses.every((a) => isPublicAddress(a.address))) {
    return failed(
      ERROR_IDS.AUTOMATION_INPUT_INVALID,
      "o webhook aponta para um endereço interno, o que não é permitido",
    );
  }
  const payload = await deps.loadDeal(deal.id);
  if (payload === null) return failed(ERROR_IDS.DEAL_NOT_FOUND, "o negócio não existe mais");

  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "warpdrive-automations" },
      body: JSON.stringify({
        event: "automation",
        sentAt: new Date().toISOString(),
        deal: payload,
      }),
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch {
    signal.throwIfAborted();
    return failed(ERROR_IDS.AUTOMATION_INPUT_INVALID, "o webhook não respondeu a tempo");
  }
  if (res.status < 200 || res.status >= 300) {
    return failed(
      ERROR_IDS.AUTOMATION_INPUT_INVALID,
      `o webhook respondeu com o status ${String(res.status)}`,
    );
  }
  return succeeded({ status: res.status });
}
