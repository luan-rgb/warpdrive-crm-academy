"use client";
import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { EmailProvider } from "@/constants/email";
import { connectMailboxStart, disconnectMailboxAction } from "@/features/email/actions";
import { formatDateTimePtBr } from "@/lib/formatDate";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";
import { ConnectOptions } from "./ConnectOptions";
import { mailboxDisplayHealth, mailboxDotClass, mailboxStatusLabel } from "./statusLabel";
import { EMAIL_SYNC_STRINGS } from "./strings";

const S = EMAIL_SYNC_STRINGS;

// Set when a mailbox connected through the retired Nylas integration was migrated (0084 migration).
const NYLAS_RETIRED_ERROR = "E_MAIL_008";

export interface MailboxView {
  id: string;
  emailAddress: string;
  provider: EmailProvider;
  status: "connected" | "disconnected" | "error";
  lastSyncAtIso: string | null;
  lastErrorId: string | null;
}

// What the student sees after the relay sends them back (?connected= / ?connect_error=).
export type ConnectNotice = { kind: "connected" | "error"; code: string } | null;

function formatSync(iso: string | null): string {
  if (iso === null) return S.neverSynced;
  return S.lastSynced(formatDateTimePtBr(new Date(iso)));
}

function NoticeBanner({ notice }: { notice: ConnectNotice }): React.ReactNode {
  if (notice === null) return null;
  if (notice.kind === "connected") {
    return (
      <p className="rounded-md border border-success/40 bg-success/10 p-2 text-sm">
        {S.connectedNotice}
      </p>
    );
  }
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">
      {S.errorNotices[notice.code] ?? S.genericErrorNotice}
    </p>
  );
}

function MailboxDetails({
  mailbox,
  health,
}: {
  mailbox: MailboxView;
  health: ReturnType<typeof mailboxDisplayHealth>;
}): React.ReactNode {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {S.connectedAs(mailbox.emailAddress, S.providerLabels[mailbox.provider])}
      </p>
      <p className="text-sm text-muted-foreground">{formatSync(mailbox.lastSyncAtIso)}</p>
      {health === "stalled" ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          {S.stalledHint}
        </p>
      ) : null}
      {mailbox.lastErrorId === NYLAS_RETIRED_ERROR ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          {S.nylasRetired}
        </p>
      ) : mailbox.lastErrorId !== null ? (
        <p className="text-sm text-red-600">
          {S.lastErrorLabel}: {mailbox.lastErrorId}
        </p>
      ) : null}
    </>
  );
}

export function EmailSyncClient({
  mailbox,
  oauthProviders,
  notice,
}: {
  mailbox: MailboxView | null;
  oauthProviders: { gmail: boolean; outlook: boolean };
  notice: ConnectNotice;
}): React.ReactNode {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock is the browser's, not the request's: rendering a stall from the server time would disagree with the tab a minute later
  useEffect(() => setNow(new Date()), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = mailbox !== null && mailbox.status === "connected";
  const health = mailboxDisplayHealth(mailbox, now);

  // Gmail/Outlook: ask the shared relay for a consent URL and hand the browser off to Google or
  // Microsoft. The relay stores the token and sends the student back here. Reconnect is the same
  // flow: the relay rebinds by user, so the same account row (and its mail history) is reused.
  async function startOAuth(provider: "gmail" | "outlook"): Promise<void> {
    setPending(true);
    setError(null);
    const r = await connectMailboxStart(provider).catch(() => null);
    if (r?.ok === true) {
      window.location.href = r.value.url;
      return;
    }
    setPending(false);
    setError(S.actionError);
  }

  async function disconnect(): Promise<void> {
    if (mailbox === null) return;
    setPending(true);
    setError(null);
    const r = await disconnectMailboxAction(readCsrfToken(), { accountId: mailbox.id });
    setPending(false);
    if (r.ok) {
      router.refresh();
    } else {
      setError(S.actionError);
    }
  }

  return (
    <SettingsCard>
      <SettingsCardHeader
        icon={<Mail className="size-4" aria-hidden="true" />}
        title={S.cardTitle}
        description={S.cardDescription}
        help="email.sync"
      />
      <SettingsCardBody className="space-y-2">
        <NoticeBanner notice={notice} />
        <div className="mb-1 flex items-center gap-2">
          <span
            data-status={mailbox?.status ?? "none"}
            data-health={health}
            className={`inline-block h-2 w-2 rounded-full ${mailboxDotClass(health)}`}
          />
          <span className="text-sm font-medium">{mailboxStatusLabel(mailbox, now)}</span>
        </div>
        {mailbox !== null ? (
          <MailboxDetails mailbox={mailbox} health={health} />
        ) : (
          <p className="text-sm text-muted-foreground">{S.notConnected}</p>
        )}
        {connected ? null : (
          <ConnectOptions
            pending={pending}
            oauthProviders={oauthProviders}
            onOAuth={(p) => void startOAuth(p)}
            onImapConnected={() => router.refresh()}
          />
        )}
      </SettingsCardBody>

      {error !== null || connected ? (
        <SettingsCardFooter className="flex-wrap gap-2">
          {error !== null ? (
            <span className="mr-auto w-full text-sm text-red-600">{error}</span>
          ) : null}
          {connected ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void disconnect()}
            >
              {pending ? S.disconnecting : S.disconnect}
            </Button>
          ) : null}
        </SettingsCardFooter>
      ) : null}
    </SettingsCard>
  );
}
