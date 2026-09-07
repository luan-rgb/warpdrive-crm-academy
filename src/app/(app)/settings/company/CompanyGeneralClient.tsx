"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { STRINGS } from "@/constants/strings";
import {
  updateCompanyGeneralAction,
  updateInvoiceBrandingAction,
} from "@/features/settings/actions";
import { InvoiceImageUpload } from "@/features/settings/InvoiceImageUpload";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "../SettingsSurface";

interface Props {
  companyName: string;
  baseCurrency: string;
  invoiceHeaderText: string;
  invoiceFooterText: string;
  invoiceHeaderImageUrl: string | null;
  invoiceFooterImageUrl: string | null;
}

// General tab (spec 6.1): editable company name + read-only base currency (currencies out of scope).
export function CompanyGeneralClient(props: Props): React.ReactNode {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(props.companyName);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setPending(true);
    setSaved(false);
    const r = await updateCompanyGeneralAction({ companyName }, readCsrfToken());
    setPending(false);
    if (r.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  const [headerText, setHeaderText] = useState(props.invoiceHeaderText);
  const [footerText, setFooterText] = useState(props.invoiceFooterText);
  const [brandingPending, setBrandingPending] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);

  async function saveBranding(): Promise<void> {
    setBrandingPending(true);
    setBrandingSaved(false);
    const r = await updateInvoiceBrandingAction(
      {
        headerText: headerText.trim() === "" ? null : headerText,
        footerText: footerText.trim() === "" ? null : footerText,
      },
      readCsrfToken(),
    );
    setBrandingPending(false);
    if (r.ok) {
      setBrandingSaved(true);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsCardBody className="grid gap-5 sm:grid-cols-2">
          <label htmlFor="company-name" className="block">
            <span className="mb-1.5 block text-sm font-medium">{STRINGS.settings.companyName}</span>
            <Input
              id="company-name"
              aria-label={STRINGS.settings.companyName}
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                setSaved(false);
              }}
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium">
              {STRINGS.settings.baseCurrency}
            </span>
            <div className="flex min-h-9 items-center rounded-md bg-muted/50 px-3 text-sm text-muted-foreground">
              {props.baseCurrency}
            </div>
          </div>
        </SettingsCardBody>

        <SettingsCardFooter>
          {saved ? (
            <span className="mr-auto text-sm text-muted-foreground">{STRINGS.settings.saved}</span>
          ) : null}
          <Button
            type="button"
            variant="default"
            size="sm"
            className="px-3"
            disabled={pending}
            onClick={() => void save()}
          >
            {STRINGS.settings.save}
          </Button>
        </SettingsCardFooter>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardHeader
          title="Invoice branding"
          description="Shown on every printed invoice, on top of the company name above."
        />
        <SettingsCardBody className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <label htmlFor="invoice-header" className="block">
              <span className="mb-1.5 block text-sm font-medium">Invoice header</span>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Shown at the top of every printed invoice: company address, tax id, contact info.
              </p>
              <Textarea
                id="invoice-header"
                aria-label="Invoice header"
                rows={5}
                value={headerText}
                onChange={(e) => {
                  setHeaderText(e.target.value);
                  setBrandingSaved(false);
                }}
              />
            </label>
            <InvoiceImageUpload
              kind="header"
              label="Header image (logo)"
              imageUrl={props.invoiceHeaderImageUrl}
            />
          </div>

          <div className="space-y-3">
            <label htmlFor="invoice-footer" className="block">
              <span className="mb-1.5 block text-sm font-medium">Invoice footer</span>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Shown at the bottom of every printed invoice: payment terms, bank details, a
                thank-you note.
              </p>
              <Textarea
                id="invoice-footer"
                aria-label="Invoice footer"
                rows={5}
                value={footerText}
                onChange={(e) => {
                  setFooterText(e.target.value);
                  setBrandingSaved(false);
                }}
              />
            </label>
            <InvoiceImageUpload
              kind="footer"
              label="Footer image (signature/stamp)"
              imageUrl={props.invoiceFooterImageUrl}
            />
          </div>
        </SettingsCardBody>

        <SettingsCardFooter>
          {brandingSaved ? (
            <span className="mr-auto text-sm text-muted-foreground">{STRINGS.settings.saved}</span>
          ) : null}
          <Button
            type="button"
            variant="default"
            size="sm"
            className="px-3"
            disabled={brandingPending}
            onClick={() => void saveBranding()}
          >
            Save branding
          </Button>
        </SettingsCardFooter>
      </SettingsCard>
    </div>
  );
}
