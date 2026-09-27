import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ConsentProps {
  action: string;
  clientName: string;
  redirectUri: string;
}

// The host that will actually receive the authorization code. This is the one attacker-controlled
// value on the screen a user can meaningfully check, so it is displayed rather than the name.
// A private-use scheme (com.example.app:/cb, RFC 8252 section 7.1) has no host at all, so fall
// back to the scheme rather than rendering an empty box that reads as a missing value.
function redirectDisplay(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.host === "" ? url.protocol.replace(/:$/, "") : url.host;
  } catch {
    return redirectUri;
  }
}

/**
 * OAuth consent screen.
 *
 * Approving mints a token that can read and write the entire CRM through /api/mcp, and with
 * dynamic registration open (the default, since it is what lets an MCP client self-onboard)
 * `clientName` is a string an unauthenticated stranger POSTed to /oauth/register. So the screen
 * deliberately does NOT say "Allow <name> to access warpdrive?": phrasing it that way puts the
 * product's own voice behind a name the product has not verified, which is the whole mechanism
 * of consent phishing. The name is shown as a self-reported label, the destination host is shown
 * next to it, and the user is told to deny if they did not start this.
 */
export function Consent({ action, clientName, redirectUri }: ConsentProps): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <section className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Pedido de conexão</p>
          <h1 className="text-balance text-2xl font-semibold">Conectar um aplicativo ao CRM?</h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Ele poderá ler e atualizar os dados do CRM que as suas permissões permitem. Ele não pode
            excluir registros. Você pode revogar o acesso depois em Configurações.
          </p>
        </div>

        <dl className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="space-y-1">
            <dt className="text-xs font-medium text-muted-foreground">
              Nome informado pelo aplicativo (não verificado)
            </dt>
            <dd data-testid="consent-client-name" className="break-words font-medium">
              {clientName}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium text-muted-foreground">
              O acesso será enviado para
            </dt>
            <dd data-testid="consent-redirect-host" className="break-all font-mono text-xs">
              {redirectDisplay(redirectUri)}
            </dd>
          </div>
        </dl>

        <p
          data-testid="consent-warning"
          className="flex gap-2 text-pretty text-xs text-muted-foreground"
        >
          <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-warning" />
          <span>
            Qualquer um pode pedir uma conexão e escolher o nome acima. Se você não acabou de
            iniciar isto a partir desse aplicativo, recuse.
          </span>
        </p>

        <form action={action} method="post" className="flex justify-end gap-2">
          <Button type="submit" name="decision" value="deny" variant="outline">
            Recusar
          </Button>
          <Button type="submit" name="decision" value="approve">
            Permitir acesso
          </Button>
        </form>
      </section>
    </main>
  );
}
