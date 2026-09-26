import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Result } from "@/types/result";
import { type ClientFactoryDeps, resolveMailClient } from "./clientFactory";
import { createGmailClient, type GmailClient } from "./gmailClient";
import { makeRefresh } from "./gmailRefresh";
import { createImapClient } from "./imapClient";
import { createOutlookClient } from "./outlookClient";

// The real transports. Every production path that needs a mailbox client (sync and send workers,
// interactive send and trash, attachment download, system mail, the spam sweep) goes through
// resolveProductionClient so none of them can forget a provider.
export const productionClientDeps: ClientFactoryDeps = {
  refreshFor: (provider, signal) => makeRefresh(signal, provider),
  gmail: createGmailClient,
  outlook: createOutlookClient,
  imap: (config) => createImapClient(config),
};

export function resolveProductionClient(
  db: Db,
  accountId: string,
  signal: AbortSignal,
): Promise<Result<GmailClient, AppError>> {
  return resolveMailClient(db, accountId, signal, productionClientDeps);
}
