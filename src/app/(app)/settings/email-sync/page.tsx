import type { ReactNode } from "react";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { getActorMailboxStatus } from "@/features/email/mailboxOwnership";
import { enqueueInitialSync } from "@/features/email/syncScheduling";
import { createContext } from "@/server/trpc/context";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { parseConnectNotice } from "./connectNotice";
import { EmailSyncClient } from "./EmailSyncClient";
import { EMAIL_SYNC_STRINGS } from "./strings";

export const metadata = { title: EMAIL_SYNC_STRINGS.title };

// Settings > Email sync (spec section 8). A "my account" page: gated to any authenticated
// actor (mirrors settings/profile), NOT the admin MANAGE gate used by Company pages. Shows the
// actor's single mailbox (email_accounts.user_id is UNIQUE) with the three free ways to connect
// it (Gmail, Outlook, IMAP/SMTP) and disconnect. The org-level email tracking default lives on
// Company > General and is intentionally NOT duplicated here.
export default async function EmailSyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const { actor } = await createContext();
  if (actor === null)
    return <p className="text-sm text-red-600">{EMAIL_SYNC_STRINGS.requiresAuth}</p>;

  const notice = parseConnectNotice(await searchParams);
  const mailbox = await getActorMailboxStatus(db, actor.id, AbortSignal.timeout(5000));

  // Gmail/Outlook are stored by the shared relay, outside this app, so nothing here has started
  // the mailbox's sync chain yet. Landing back on this page is the first moment the app knows.
  // Idempotent (singletonKey), so a reload is harmless.
  if (notice?.kind === "connected" && mailbox?.status === "connected") {
    await enqueueInitialSync(mailbox.id);
  }

  return (
    <SettingsPage>
      <SettingsHeading title={EMAIL_SYNC_STRINGS.title} description={EMAIL_SYNC_STRINGS.intro} />
      <EmailSyncClient
        mailbox={
          mailbox === null
            ? null
            : {
                id: mailbox.id,
                emailAddress: mailbox.emailAddress,
                provider: mailbox.provider,
                status: mailbox.status,
                lastSyncAtIso: mailbox.lastSyncAt?.toISOString() ?? null,
                lastErrorId: mailbox.lastErrorId,
              }
        }
        oauthProviders={{
          gmail: env.GMAIL_OAUTH_CLIENT_ID !== "",
          outlook: env.MICROSOFT_OAUTH_CLIENT_ID !== "",
        }}
        notice={notice}
      />
    </SettingsPage>
  );
}
