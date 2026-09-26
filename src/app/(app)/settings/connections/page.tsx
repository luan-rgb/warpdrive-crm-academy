import type { ReactNode } from "react";
import { env } from "@/config/env";
import { STRINGS } from "@/constants/strings";
import { getActorMailboxStatus } from "@/features/email/mailboxOwnership";
import { listProviders } from "@/features/enrichment/providersRepo";
import { listWebhookTargets } from "@/features/integrations/webhookTargets";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { ConnectionsClient } from "./ConnectionsClient";
import { IntegrationsOverview } from "./IntegrationsOverview";

const S = STRINGS.settings;

export const metadata = { title: S.connectedApps };

export default async function ConnectionsPage(): Promise<ReactNode> {
  const ctx = await createContext();
  if (ctx.actor === null) return <p className="text-sm text-red-600">{S.requiresAuth}</p>;

  const { actor, db } = ctx;
  const signal = AbortSignal.timeout(5000);
  const [connections, mailbox, providers, webhooks] = await Promise.all([
    createCaller(ctx).oauth.listConnections(),
    getActorMailboxStatus(db, actor.id, signal),
    actor.type === "admin" ? listProviders(db, signal) : null,
    can(actor, "automation.manage") ? listWebhookTargets(db, signal) : null,
  ]);
  return (
    <SettingsPage>
      <SettingsHeading
        help="settings.connections"
        title={S.connectedApps}
        description={S.connectedAppsDescription}
      />
      <IntegrationsOverview
        mcpUrl={new URL("/api/mcp", env.BASE_URL).toString()}
        email={
          mailbox === null
            ? null
            : {
                provider: mailbox.provider,
                emailAddress: mailbox.emailAddress,
                status: mailbox.status,
                lastSyncAtIso: mailbox.lastSyncAt?.toISOString() ?? null,
              }
        }
        enrichment={
          providers?.map((p) => ({ provider: p.provider, enabled: p.enabled, hasKey: p.hasKey })) ??
          null
        }
        webhooks={webhooks}
      />
      <ConnectionsClient
        connections={connections.map((row) => ({
          clientId: row.clientId,
          clientName: row.clientName,
          connectedAtIso: row.connectedAt?.toISOString() ?? null,
          lastUsedAtIso: row.lastUsedAt?.toISOString() ?? null,
        }))}
      />
    </SettingsPage>
  );
}
