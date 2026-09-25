// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectGmailStart = vi.fn();
const connectNylasStart = vi.fn();
const disconnectMailboxAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/features/email/actions", () => ({
  connectGmailStart: () => connectGmailStart(),
  connectNylasStart: (provider: "google" | "microsoft") => connectNylasStart(provider),
  disconnectMailboxAction: (csrf: string | null, input: unknown) =>
    disconnectMailboxAction(csrf, input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf-token" }));

import { EmailSyncClient, type MailboxView } from "./EmailSyncClient";

const originalLocation = window.location;

const connected: MailboxView = {
  id: "acc-1",
  emailAddress: "rep@example.com",
  status: "connected",
  lastSyncAtIso: "2026-07-01T10:00:00.000Z",
  lastErrorId: null,
};

beforeEach(() => {
  connectGmailStart.mockReset();
  connectNylasStart.mockReset();
  disconnectMailboxAction.mockReset();
  refresh.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { href: "" } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("EmailSyncClient", () => {
  it("shows Connect when no mailbox is linked and redirects to the consent URL", async () => {
    connectGmailStart.mockResolvedValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    });
    render(<EmailSyncClient mailbox={null} googleConfigured={true} nylasConfigured={false} />);
    expect(screen.getByText("Nenhuma caixa de entrada conectada ainda.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar Gmail" }));
    await waitFor(() =>
      expect(window.location.href).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1"),
    );
    expect(connectGmailStart).toHaveBeenCalledTimes(1);
  });

  it("shows the connected address, last sync, and a Disconnect button when connected", () => {
    render(<EmailSyncClient mailbox={connected} googleConfigured={true} nylasConfigured={false} />);
    expect(screen.getByText("Conectado como rep@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Última sincronização/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeInTheDocument();
  });

  it("Disconnect calls the action with csrf + account id then refreshes", async () => {
    disconnectMailboxAction.mockResolvedValue({ ok: true, value: { disconnected: true } });
    render(<EmailSyncClient mailbox={connected} googleConfigured={true} nylasConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() =>
      expect(disconnectMailboxAction).toHaveBeenCalledWith("csrf-token", { accountId: "acc-1" }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows Reconnect and the last error for a disconnected mailbox", () => {
    render(
      <EmailSyncClient
        mailbox={{ ...connected, status: "disconnected", lastErrorId: "E_GMAIL_002" }}
        googleConfigured={true}
        nylasConfigured={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Reconectar" })).toBeInTheDocument();
    expect(screen.getByText(/E_GMAIL_002/)).toBeInTheDocument();
  });

  it("fills the disconnected status dot from a token so it shows on a dark card", () => {
    const { container } = render(
      <EmailSyncClient mailbox={null} googleConfigured={true} nylasConfigured={false} />,
    );
    const dot = container.querySelector('[data-status="none"]');
    expect(dot).toHaveClass("bg-muted-foreground/40");
    expect(dot?.className).not.toMatch(/-gray-/);
  });

  it("shows Gmail and Outlook (via Nylas) buttons when nylasConfigured, no Google button", () => {
    render(<EmailSyncClient mailbox={null} googleConfigured={false} nylasConfigured={true} />);
    expect(screen.getByRole("button", { name: "Conectar Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar Outlook" })).toBeInTheDocument();
  });

  it("Connect Outlook calls connectNylasStart('microsoft') and redirects", async () => {
    connectNylasStart.mockResolvedValue({ url: "https://api.us.nylas.com/v3/connect/auth?x=1" });
    render(<EmailSyncClient mailbox={null} googleConfigured={false} nylasConfigured={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Outlook" }));
    await waitFor(() =>
      expect(window.location.href).toBe("https://api.us.nylas.com/v3/connect/auth?x=1"),
    );
    expect(connectNylasStart).toHaveBeenCalledWith("microsoft");
  });

  it("shows neither provider's buttons when nothing is configured", () => {
    render(<EmailSyncClient mailbox={null} googleConfigured={false} nylasConfigured={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
