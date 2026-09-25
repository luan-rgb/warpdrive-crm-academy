import type React from "react";
import { env } from "@/config/env";
import { STRINGS } from "@/constants/strings";

interface Props {
  searchParams: Promise<{ sent?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: Props): Promise<React.ReactNode> {
  const { sent, error } = await searchParams;
  const googleConfigured = env.GOOGLE_OAUTH_CLIENT_ID !== "";
  const magicLinkConfigured = env.RESEND_API_KEY !== "" && env.MAGIC_LINK_FROM_EMAIL !== "";

  return (
    <main className="flex h-screen items-center justify-center">
      <div className="w-80 space-y-4 rounded-lg border p-6 text-center">
        <h1 className="text-balance text-xl font-semibold">{STRINGS.auth.loginTitle}</h1>

        {sent === "1" && (
          <p className="text-pretty text-sm text-muted-foreground">{STRINGS.auth.magicLinkSent}</p>
        )}
        {error === "invalid_email" && (
          <p className="text-pretty text-sm text-destructive">
            {STRINGS.auth.magicLinkInvalidEmail}
          </p>
        )}
        {error === "auth_failed" && (
          <p className="text-pretty text-sm text-destructive">{STRINGS.auth.magicLinkAuthFailed}</p>
        )}

        {googleConfigured && (
          <>
            <p className="text-pretty text-sm text-muted-foreground">{STRINGS.auth.domainOnly}</p>
            <a
              href="/auth/start"
              className="inline-flex w-full items-center justify-center rounded-md bg-action px-4 py-2 text-sm text-action-foreground transition-transform active:scale-[0.96]"
            >
              {STRINGS.auth.signInWithGoogle}
            </a>
          </>
        )}

        {googleConfigured && magicLinkConfigured && (
          <p className="text-xs text-muted-foreground">{STRINGS.auth.orDivider}</p>
        )}

        {magicLinkConfigured && (
          <form action="/auth/magic-link/request" method="POST" className="space-y-2">
            <input
              type="email"
              name="email"
              required
              placeholder={STRINGS.auth.emailPlaceholder}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center rounded-md border px-4 py-2 text-sm transition-transform active:scale-[0.96]"
            >
              {STRINGS.auth.sendMagicLink}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
