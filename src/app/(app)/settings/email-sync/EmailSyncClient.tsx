"use client";
import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  connectGmailStart,
  connectNylasStart,
  disconnectMailboxAction,
} from "@/features/email/actions";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";
import { mailboxDisplayHealth, mailboxDotClass, mailboxStatusLabel } from "./statusLabel";
import { EMAIL_SYNC_STRINGS } from "./strings";

const S = EMAIL_SYNC_STRINGS;

export interface MailboxView {
  id: string;
  emailAddress: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAtIso: string | null;
  lastErrorId: string | null;
}

function formatSync(iso: string | null): string {
  if (iso === null) return S.neverSynced;
  return S.lastSynced(new Date(iso).toLocaleString());
}

export function EmailSyncClient({
  mailbox,
  googleConfigured,
  nylasConfigured,
}: {
  mailbox: MailboxView | null;
  googleConfigured: boolean;
  nylasConfigured: boolean;
}): React.ReactNode {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock is the browser's, not the request's: rendering a stall from the server time would disagree with the tab a minute later
  useEffect(() => setNow(new Date()), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = mailbox !== null && mailbox.status === "connected";
  const health = mailboxDisplayHealth(mailbox, now);

  // Connect a fresh mailbox or reconnect a disconnected/error one: both mint a consent URL
  // server-side (which also sets the single-use OAuth state cookie) and hand off to Google.
  // The OAuth callback rebinds the row, so reconnect reuses the same account, not a duplicate.
  async function startConnect(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const { url } = await connectGmailStart();
      window.location.href = url;
    } catch {
      // Minting the consent URL failed (dead session or transient error): un-stick the button
      // and surface a retry hint rather than leaving it disabled on "Connecting..." forever.
      setPending(false);
      setError(S.actionError);
    }
  }

  // Same idea as startConnect, but via Nylas (src/features/email/nylasClient.ts): works for any
  // student's own Gmail or Outlook, not just accounts in one Google Workspace domain, and needs
  // no per-tenant setup (see the design doc). The reconnect callback also rebinds by user_id, so
  // this is safe to offer for reconnect too, not just a first-time connect.
  async function startConnectNylas(provider: "google" | "microsoft"): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const { url } = await connectNylasStart(provider);
      window.location.href = url;
    } catch {
      setPending(false);
      setError(S.actionError);
    }
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
        title="Conexão do Gmail"
        description="Conecte uma caixa de email para sincronizar mensagens e atividades."
      />
      <SettingsCardBody>
        <div className="mb-1 flex items-center gap-2">
          <span
            data-status={mailbox?.status ?? "none"}
            data-health={health}
            className={`inline-block h-2 w-2 rounded-full ${mailboxDotClass(health)}`}
          />
          <span className="text-sm font-medium">{mailboxStatusLabel(mailbox, now)}</span>
        </div>
        {mailbox !== null ? (
          <>
            <p className="text-sm text-muted-foreground">{S.connectedAs(mailbox.emailAddress)}</p>
            <p className="text-sm text-muted-foreground">{formatSync(mailbox.lastSyncAtIso)}</p>
            {health === "stalled" ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
                {S.stalledHint}
              </p>
            ) : null}
            {mailbox.lastErrorId !== null ? (
              <p className="text-sm text-red-600">
                {S.lastErrorLabel}: {mailbox.lastErrorId}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{S.notConnected}</p>
        )}
      </SettingsCardBody>

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
        ) : (
          <ConnectButtons
            pending={pending}
            hasMailbox={mailbox !== null}
            googleConfigured={googleConfigured}
            nylasConfigured={nylasConfigured}
            onGoogle={() => void startConnect()}
            onNylas={(provider) => void startConnectNylas(provider)}
          />
        )}
      </SettingsCardFooter>
    </SettingsCard>
  );
}

// Split out from the main render (kept the component's cognitive complexity under the project's
// lint budget): which connect buttons show at all depends only on which providers this
// deployment has configured (nylasConfigured / googleConfigured), never on connection state
// (the caller only renders this in the not-connected branch).
function ConnectButtons({
  pending,
  hasMailbox,
  googleConfigured,
  nylasConfigured,
  onGoogle,
  onNylas,
}: {
  pending: boolean;
  hasMailbox: boolean;
  googleConfigured: boolean;
  nylasConfigured: boolean;
  onGoogle: () => void;
  onNylas: (provider: "google" | "microsoft") => void;
}): React.ReactNode {
  return (
    <>
      {nylasConfigured && (
        <>
          <Button type="button" disabled={pending} onClick={() => onNylas("google")}>
            {pending ? S.connecting : hasMailbox ? S.reconnect : S.connect}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onNylas("microsoft")}
          >
            {pending ? S.connecting : S.connectOutlook}
          </Button>
        </>
      )}
      {googleConfigured && (
        <Button
          type="button"
          variant={nylasConfigured ? "outline" : "default"}
          disabled={pending}
          onClick={onGoogle}
        >
          {pending ? S.connecting : hasMailbox ? S.reconnect : S.connect}
        </Button>
      )}
    </>
  );
}
