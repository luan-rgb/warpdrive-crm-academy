"use client";
import { Inbox, Mail, Server } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import type { HelpTopic } from "@/constants/helpTexts";
import { ImapConnectDialog } from "./ImapConnectDialog";
import { EMAIL_SYNC_STRINGS } from "./strings";

const S = EMAIL_SYNC_STRINGS;

function Option({
  icon,
  help,
  title,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  help: HelpTopic;
  title: string;
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}): React.ReactNode {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
        <HelpTooltip topic={help} />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Button type="button" size="sm" disabled={disabled} onClick={onClick} className="mt-auto">
        {label}
      </Button>
    </div>
  );
}

// The three ways to connect a mailbox, all free: Gmail and Outlook through OAuth (only shown when
// the deployment has the shared OAuth app configured) and any other provider through IMAP/SMTP.
export function ConnectOptions({
  pending,
  oauthProviders,
  onOAuth,
  onImapConnected,
}: {
  pending: boolean;
  oauthProviders: { gmail: boolean; outlook: boolean };
  onOAuth: (provider: "gmail" | "outlook") => void;
  onImapConnected: () => void;
}): React.ReactNode {
  const [imapOpen, setImapOpen] = useState(false);
  return (
    <div className="space-y-2 pt-2">
      <p className="text-sm font-medium">{S.chooseProvider}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {oauthProviders.gmail ? (
          <Option
            icon={<Mail className="size-4" aria-hidden="true" />}
            title="Gmail"
            help="email.gmail"
            label={pending ? S.connecting : S.connectGmail}
            hint={S.gmailHint}
            disabled={pending}
            onClick={() => onOAuth("gmail")}
          />
        ) : null}
        {oauthProviders.outlook ? (
          <Option
            icon={<Inbox className="size-4" aria-hidden="true" />}
            title="Outlook"
            help="email.outlook"
            label={pending ? S.connecting : S.connectOutlook}
            hint={S.outlookHint}
            disabled={pending}
            onClick={() => onOAuth("outlook")}
          />
        ) : null}
        <Option
          icon={<Server className="size-4" aria-hidden="true" />}
          title="IMAP/SMTP"
          help="email.imap"
          label={S.connectOther}
          hint={S.otherHint}
          disabled={pending}
          onClick={() => setImapOpen(true)}
        />
      </div>
      <ImapConnectDialog
        open={imapOpen}
        onOpenChange={setImapOpen}
        onConnected={() => {
          setImapOpen(false);
          onImapConnected();
        }}
      />
    </div>
  );
}
