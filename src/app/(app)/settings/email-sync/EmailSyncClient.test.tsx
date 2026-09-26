// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectMailboxStart = vi.fn();
const disconnectMailboxAction = vi.fn();
const connectImapAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/features/email/actions", () => ({
  connectMailboxStart: (provider: string) => connectMailboxStart(provider),
  disconnectMailboxAction: (csrf: string | null, input: unknown) =>
    disconnectMailboxAction(csrf, input),
}));
vi.mock("@/features/email/imapActions", () => ({
  connectImapAction: (csrf: string | null, input: unknown) => connectImapAction(csrf, input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf-token" }));

import { EmailSyncClient, type MailboxView } from "./EmailSyncClient";

const originalLocation = window.location;

const connected: MailboxView = {
  id: "acc-1",
  emailAddress: "rep@example.com",
  provider: "gmail",
  status: "connected",
  lastSyncAtIso: "2026-07-01T10:00:00.000Z",
  lastErrorId: null,
};

const BOTH = { gmail: true, outlook: true };

beforeEach(() => {
  connectMailboxStart.mockReset();
  disconnectMailboxAction.mockReset();
  connectImapAction.mockReset();
  refresh.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("EmailSyncClient", () => {
  it("offers the three ways to connect when no mailbox is linked", () => {
    render(<EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />);
    expect(screen.getByText("Nenhuma caixa de entrada conectada ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Outlook" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outro provedor (IMAP/SMTP)" })).toBeInTheDocument();
  });

  it("Gmail asks for a consent URL and follows it", async () => {
    connectMailboxStart.mockResolvedValue({
      ok: true,
      value: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" },
    });
    render(<EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Gmail" }));
    await waitFor(() =>
      expect(window.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1"),
    );
    expect(connectMailboxStart).toHaveBeenCalledWith("gmail");
  });

  it("Outlook asks for the Microsoft consent URL", async () => {
    connectMailboxStart.mockResolvedValue({
      ok: true,
      value: { url: "https://login.microsoftonline.com/x" },
    });
    render(<EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Outlook" }));
    await waitFor(() => expect(window.location.href).toBe("https://login.microsoftonline.com/x"));
    expect(connectMailboxStart).toHaveBeenCalledWith("outlook");
  });

  it("a failed consent request re-enables the buttons and says so", async () => {
    connectMailboxStart.mockResolvedValue({ ok: false, error: { id: "E_MAIL_007" } });
    render(<EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Gmail" }));
    expect(await screen.findByText(/Não foi possível concluir/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Gmail" })).toBeEnabled();
  });

  it("hides OAuth options that are not configured, but IMAP/SMTP is always available", () => {
    render(
      <EmailSyncClient
        mailbox={null}
        oauthProviders={{ gmail: false, outlook: false }}
        notice={null}
      />,
    );
    expect(screen.queryByRole("button", { name: "Conectar Gmail" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar Outlook" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outro provedor (IMAP/SMTP)" })).toBeInTheDocument();
  });

  it("shows the provider, address, last sync and Disconnect when connected", () => {
    render(
      <EmailSyncClient
        mailbox={{ ...connected, provider: "outlook" }}
        oauthProviders={BOTH}
        notice={null}
      />,
    );
    expect(screen.getByText("Conectado como rep@example.com (Outlook)")).toBeInTheDocument();
    expect(screen.getByText(/Última sincronização/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar Gmail" })).not.toBeInTheDocument();
  });

  it("Disconnect calls the action with csrf + account id then refreshes", async () => {
    disconnectMailboxAction.mockResolvedValue({ ok: true, value: { disconnected: true } });
    render(<EmailSyncClient mailbox={connected} oauthProviders={BOTH} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() =>
      expect(disconnectMailboxAction).toHaveBeenCalledWith("csrf-token", { accountId: "acc-1" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a mailbox retired with Nylas explains it must be reconnected, and offers the options", () => {
    render(
      <EmailSyncClient
        mailbox={{ ...connected, status: "disconnected", lastErrorId: "E_MAIL_008" }}
        oauthProviders={BOTH}
        notice={null}
      />,
    );
    expect(screen.getByText(/precisa ser reconectada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Gmail" })).toBeInTheDocument();
  });

  it("explains a failed return from Google/Microsoft in Portuguese", () => {
    render(
      <EmailSyncClient
        mailbox={null}
        oauthProviders={BOTH}
        notice={{ kind: "error", code: "taken" }}
      />,
    );
    expect(screen.getByText(/já está conectado por outro usuário/)).toBeInTheDocument();
  });

  it("confirms a successful connection", () => {
    render(
      <EmailSyncClient
        mailbox={connected}
        oauthProviders={BOTH}
        notice={{ kind: "connected", code: "gmail" }}
      />,
    );
    expect(screen.getByText(/conectada com sucesso/)).toBeInTheDocument();
  });

  it("fills the disconnected status dot from a token so it shows on a dark card", () => {
    const { container } = render(
      <EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />,
    );
    const dot = container.querySelector('[data-status="none"]');
    expect(dot).toHaveClass("bg-muted-foreground/40");
    expect(dot?.className).not.toMatch(/-gray-/);
  });
});

describe("IMAP/SMTP dialog", () => {
  function openDialog(): void {
    render(<EmailSyncClient mailbox={null} oauthProviders={BOTH} notice={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Outro provedor (IMAP/SMTP)" }));
  }

  it("fills the server settings from a known address domain", async () => {
    openDialog();
    const email = await screen.findByLabelText("E-mail");
    fireEvent.change(email, { target: { value: "luan@yahoo.com.br" } });
    fireEvent.blur(email);
    expect(screen.getByLabelText("Servidor IMAP")).toHaveValue("imap.mail.yahoo.com");
    expect(screen.getByLabelText("Servidor SMTP")).toHaveValue("smtp.mail.yahoo.com");
    expect(screen.getByLabelText("Usuário")).toHaveValue("luan@yahoo.com.br");
    expect(screen.getByText(/exige uma senha de app/)).toBeInTheDocument();
  });

  it("submits the typed settings and refreshes on success", async () => {
    connectImapAction.mockResolvedValue({ ok: true, value: { accountId: "a" } });
    openDialog();
    fireEvent.change(await screen.findByLabelText("E-mail"), {
      target: { value: "vendas@empresa.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Usuário"), {
      target: { value: "vendas@empresa.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo" } });
    fireEvent.change(screen.getByLabelText("Servidor IMAP"), {
      target: { value: "imap.empresa.com.br" },
    });
    fireEvent.change(screen.getByLabelText("Servidor SMTP"), {
      target: { value: "smtp.empresa.com.br" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Testar e conectar" }));
    await waitFor(() =>
      expect(connectImapAction).toHaveBeenCalledWith("csrf-token", {
        emailAddress: "vendas@empresa.com.br",
        username: "vendas@empresa.com.br",
        password: "segredo",
        imap: { host: "imap.empresa.com.br", port: 993, secure: true },
        smtp: { host: "smtp.empresa.com.br", port: 465, secure: true },
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a failed login keeps the dialog open with a hint about app passwords", async () => {
    connectImapAction.mockResolvedValue({ ok: false, error: { id: "E_MAIL_005" } });
    openDialog();
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Servidor IMAP"), { target: { value: "imap.b.com" } });
    fireEvent.change(screen.getByLabelText("Servidor SMTP"), { target: { value: "smtp.b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Testar e conectar" }));
    expect(await screen.findByText(/Não conseguimos entrar/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
