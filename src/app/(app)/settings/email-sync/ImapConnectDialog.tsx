"use client";
import type React from "react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { IMAP_PRESETS, type ImapPreset, presetForAddress } from "@/constants/imapPresets";
import { connectImapAction } from "@/features/email/imapActions";
import { readCsrfToken } from "@/utils/csrfCookie";
import { EMAIL_SYNC_STRINGS } from "./strings";

const S = EMAIL_SYNC_STRINGS.imap;
const CUSTOM = "custom";

interface Endpoint {
  host: string;
  port: string;
  secure: boolean;
}

const DEFAULT_IMAP: Endpoint = { host: "", port: "993", secure: true };
const DEFAULT_SMTP: Endpoint = { host: "", port: "465", secure: true };

function fromPreset(p: ImapPreset["imap"]): Endpoint {
  return { host: p.host, port: String(p.port), secure: p.secure };
}

function Field({
  label,
  children,
  id,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function EndpointFields({
  prefix,
  hostLabel,
  portLabel,
  value,
  onChange,
}: {
  prefix: string;
  hostLabel: string;
  portLabel: string;
  value: Endpoint;
  onChange: (v: Endpoint) => void;
}): React.ReactNode {
  return (
    <div className="grid grid-cols-[1fr_6rem] gap-2">
      <Field label={hostLabel} id={`${prefix}-host`}>
        <Input
          id={`${prefix}-host`}
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field label={portLabel} id={`${prefix}-port`}>
        <Input
          id={`${prefix}-port`}
          inputMode="numeric"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, "") })}
        />
      </Field>
      <div className="col-span-2 flex items-center gap-2">
        <Switch
          id={`${prefix}-secure`}
          checked={value.secure}
          onCheckedChange={(secure) => onChange({ ...value, secure })}
          label={`${hostLabel}: ${S.secure}`}
        />
        <label htmlFor={`${prefix}-secure`} className="text-xs text-muted-foreground">
          {S.secure}
        </label>
      </div>
    </div>
  );
}

// "Outro provedor (IMAP/SMTP)": the free, provider-agnostic way to connect a mailbox. The server
// action logs in to both servers before anything is saved, so a wrong host or password is caught
// here, and the password is stored encrypted.
export function ImapConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}): React.ReactNode {
  const id = useId();
  const [preset, setPreset] = useState(CUSTOM);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState<Endpoint>(DEFAULT_IMAP);
  const [smtp, setSmtp] = useState<Endpoint>(DEFAULT_SMTP);
  const [appHint, setAppHint] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: ImapPreset | undefined): void {
    setPreset(p?.label ?? CUSTOM);
    if (p === undefined) return;
    setImap(fromPreset(p.imap));
    setSmtp(fromPreset(p.smtp));
    setAppHint(p.appPasswordHint);
  }

  function onEmailBlur(): void {
    if (username.trim() === "") setUsername(email.trim());
    const found = presetForAddress(email);
    if (found !== undefined) applyPreset(found);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const address = email.trim();
    const r = await connectImapAction(readCsrfToken(), {
      emailAddress: address,
      username: username.trim() === "" ? address : username.trim(),
      password,
      imap: { host: imap.host.trim(), port: Number(imap.port), secure: imap.secure },
      smtp: { host: smtp.host.trim(), port: Number(smtp.port), secure: smtp.secure },
    }).catch(() => null);
    setPending(false);
    if (r?.ok === true) {
      setPassword("");
      onConnected();
      return;
    }
    const failures: Record<string, string> = {
      E_MAIL_006: S.invalid,
      E_MAIL_010: S.hostBlocked,
      E_RATE_001: S.rateLimited,
    };
    setError(failures[r?.error.id ?? ""] ?? S.loginFailed);
  }

  const presetOptions = [
    { value: CUSTOM, label: S.custom },
    ...IMAP_PRESETS.map((p) => ({ value: p.label, label: p.label })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{S.title}</DialogTitle>
          <DialogDescription>{S.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <Field label={S.preset} id={`${id}-preset`}>
            <Select
              value={preset}
              onChange={(v) => applyPreset(IMAP_PRESETS.find((p) => p.label === v))}
              options={presetOptions}
              ariaLabel={S.preset}
              placeholder={S.presetPlaceholder}
            />
          </Field>
          <Field label={S.email} id={`${id}-email`}>
            <Input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={onEmailBlur}
              autoComplete="email"
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={S.username} id={`${id}-user`}>
              <Input
                id={`${id}-user`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </Field>
            <Field label={S.password} id={`${id}-password`}>
              <Input
                id={`${id}-password`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          </div>
          {appHint ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              {S.appPasswordHint}
            </p>
          ) : null}
          <EndpointFields
            prefix={`${id}-imap`}
            hostLabel={S.imapHost}
            portLabel={S.imapPort}
            value={imap}
            onChange={setImap}
          />
          <EndpointFields
            prefix={`${id}-smtp`}
            hostLabel={S.smtpHost}
            portLabel={S.smtpPort}
            value={smtp}
            onChange={setSmtp}
          />
          <p className="text-xs text-muted-foreground">{S.secureHint}</p>
          {error !== null ? <p className="text-sm text-red-600">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {S.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? S.submitting : S.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
