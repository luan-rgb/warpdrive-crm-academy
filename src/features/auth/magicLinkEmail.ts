/**
 * Sends the magic-link sign-in email via Resend's plain REST API. No SDK: this is the one
 * endpoint this app needs, and a raw fetch keeps the dependency list unchanged.
 *
 * Config is an explicit param, not read from env.ts directly (same shape as devLogin.ts's
 * injected DevLoginEnv): keeps this module testable without touching process.env, which the
 * lint config (eslint.config.mjs) deliberately bans outside env.ts and env.test.ts.
 */

import { err, ok, type Result } from "@/types/result";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
}

export interface SendMagicLinkEmailArgs {
  to: string;
  verifyUrl: string;
}

export async function sendMagicLinkEmail(
  args: SendMagicLinkEmailArgs,
  deps: { config: ResendConfig; signal: AbortSignal },
): Promise<Result<true, string>> {
  const { apiKey, fromEmail } = deps.config;
  if (apiKey === "" || fromEmail === "") {
    return err("magic_link_email_not_configured");
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: args.to,
        subject: "Seu link de acesso",
        html: `<p>Clique para entrar: <a href="${args.verifyUrl}">${args.verifyUrl}</a></p><p>Este link expira em 15 minutos e só funciona uma vez.</p>`,
      }),
      signal: deps.signal,
    });
    if (!res.ok) return err(`resend_error_${res.status}`);
    return ok(true);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return err("resend_timeout");
    return err("resend_request_failed");
  }
}
