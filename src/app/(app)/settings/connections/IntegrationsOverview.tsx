import { Bot, Mail, Sparkles, Webhook } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { EmailProvider } from "@/constants/email";
import { ENRICHMENT_STRINGS } from "@/constants/enrichmentStrings";
import type { MailboxStatus } from "@/features/email/mailboxOwnership";
import type { ProviderId } from "@/features/enrichment/providers/types";
import type { WebhookTarget } from "@/features/integrations/webhookTargets";
import { formatDateTimePtBr } from "@/lib/formatDate";
import { EMAIL_SYNC_STRINGS } from "../email-sync/strings";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";
import { CONNECTIONS_STRINGS as S } from "./strings";

export interface EmailIntegrationView {
  provider: EmailProvider;
  emailAddress: string;
  status: MailboxStatus;
  lastSyncAtIso: string | null;
}

export interface EnrichmentIntegrationView {
  provider: ProviderId;
  enabled: boolean;
  hasKey: boolean;
}

const LINK = "text-sm font-medium underline underline-offset-4";

function EmailCard({ email }: { email: EmailIntegrationView | null }): React.ReactNode {
  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Mail className="size-4" aria-hidden="true" />}
        title={S.emailTitle}
        description={S.emailDescription}
        help="email.sync"
      />
      <SettingsCardBody className="space-y-2">
        {email === null ? (
          <p className="text-sm text-muted-foreground">{S.emailNone}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{email.emailAddress}</span>
              <span className="text-muted-foreground">
                ({EMAIL_SYNC_STRINGS.providerLabels[email.provider]})
              </span>
              <Badge variant={email.status === "connected" ? "success" : "destructive"}>
                {S.emailStatus[email.status]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {email.lastSyncAtIso === null
                ? S.emailNeverSynced
                : S.emailLastSync(formatDateTimePtBr(new Date(email.lastSyncAtIso)))}
            </p>
          </>
        )}
        <Link href="/settings/email-sync" className={LINK}>
          {email === null ? S.emailConnect : S.emailConfigure}
        </Link>
      </SettingsCardBody>
    </SettingsCard>
  );
}

function EnrichmentCard({
  providers,
}: {
  providers: EnrichmentIntegrationView[];
}): React.ReactNode {
  const active = providers.filter((p) => p.enabled && p.hasKey);
  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Sparkles className="size-4" aria-hidden="true" />}
        title={S.enrichmentTitle}
        description={S.enrichmentDescription}
      />
      <SettingsCardBody className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {S.enrichmentActive(active.length, providers.length)}
        </p>
        {active.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {active.map((p) => (
              <li key={p.provider}>
                <Badge variant="secondary">
                  {ENRICHMENT_STRINGS.settings.providerNames[p.provider]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Link href="/settings/enrichment" className={LINK}>
          {S.enrichmentConfigure}
        </Link>
      </SettingsCardBody>
    </SettingsCard>
  );
}

function WebhooksCard({ webhooks }: { webhooks: WebhookTarget[] }): React.ReactNode {
  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Webhook className="size-4" aria-hidden="true" />}
        title={S.webhooksTitle}
        description={S.webhooksDescription}
        help="automation.actions"
      />
      <SettingsCardBody className="space-y-2">
        {webhooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{S.webhooksNone}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {webhooks.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: one rule can call several webhooks
              <li key={`${w.ruleId}-${i}`}>
                <Link href={`/settings/automations/${w.ruleId}`} className="underline">
                  {w.ruleName}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  para {w.host}
                  {w.isActive ? "" : ` (${S.webhookPaused})`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/settings/automations/new" className={LINK}>
          {S.webhooksCreate}
        </Link>
      </SettingsCardBody>
    </SettingsCard>
  );
}

// Real state of every integration this CRM has, so "Apps conectados" is never an empty page.
export function IntegrationsOverview({
  email,
  mcpUrl,
  enrichment,
  webhooks,
}: {
  email: EmailIntegrationView | null;
  mcpUrl: string;
  // null = the viewer cannot manage this integration, so the card is not shown.
  enrichment: EnrichmentIntegrationView[] | null;
  webhooks: WebhookTarget[] | null;
}): React.ReactNode {
  return (
    <div className="space-y-4">
      <EmailCard email={email} />
      <SettingsCard>
        <SettingsCardHeader
          icon={<Bot className="size-4" aria-hidden="true" />}
          title={S.mcpTitle}
          description={S.mcpDescription}
        />
        <SettingsCardBody>
          <code className="block rounded bg-muted px-3 py-2 text-sm break-all">{mcpUrl}</code>
        </SettingsCardBody>
      </SettingsCard>
      {enrichment !== null && <EnrichmentCard providers={enrichment} />}
      {webhooks !== null && <WebhooksCard webhooks={webhooks} />}
    </div>
  );
}
