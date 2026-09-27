// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IntegrationsOverview } from "./IntegrationsOverview";

afterEach(cleanup);

const BASE = {
  mcpUrl: "https://acme.example.com/api/mcp",
  enrichment: [
    { provider: "apollo" as const, enabled: true, hasKey: true },
    { provider: "rocketreach" as const, enabled: false, hasKey: false },
    { provider: "getprospect" as const, enabled: false, hasKey: false },
  ],
  webhooks: [{ ruleId: "r1", ruleName: "Avisar Zapier", host: "hooks.zapier.com", isActive: true }],
};

it("shows the real e-mail connection with provider, address and a link to configure it", () => {
  render(
    <IntegrationsOverview
      {...BASE}
      email={{
        provider: "outlook",
        emailAddress: "ana@acme.com",
        status: "connected",
        lastSyncAtIso: null,
      }}
    />,
  );
  expect(screen.getByText(/ana@acme\.com/)).toBeInTheDocument();
  expect(screen.getByText(/Outlook/)).toBeInTheDocument();
  expect(screen.getByText("Conectado")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Configurar e-mail" })).toHaveAttribute(
    "href",
    "/settings/email-sync",
  );
});

it("says no mailbox is connected when there is none", () => {
  render(<IntegrationsOverview {...BASE} email={null} />);
  expect(screen.getByText("Nenhuma caixa de e-mail conectada.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Conectar e-mail" })).toBeInTheDocument();
});

it("shows the MCP URL, active enrichment providers and webhook destinations", () => {
  render(<IntegrationsOverview {...BASE} email={null} />);
  expect(screen.getByText("https://acme.example.com/api/mcp")).toBeInTheDocument();
  expect(screen.getByText("Apollo")).toBeInTheDocument();
  expect(screen.getByText("1 de 3 provedores ativos")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Avisar Zapier" })).toHaveAttribute(
    "href",
    "/settings/automations/r1",
  );
  expect(screen.getByText(/hooks\.zapier\.com/)).toBeInTheDocument();
});

it("hides the admin-only cards when the viewer cannot manage them", () => {
  render(
    <IntegrationsOverview mcpUrl={BASE.mcpUrl} email={null} enrichment={null} webhooks={null} />,
  );
  expect(screen.queryByText("Enriquecimento")).not.toBeInTheDocument();
  expect(screen.queryByText("Webhooks das automações")).not.toBeInTheDocument();
});
