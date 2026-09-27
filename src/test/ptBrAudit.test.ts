// Guard for the "the whole UI is in Brazilian Portuguese" requirement. Scans every user-visible
// string in the app's source (JSX text, visible attributes like placeholder/aria-label/title, label
// and message properties, copy modules and label maps) with the TypeScript compiler, and fails when
// something new reads as English. Also bans dates formatted in the viewer's browser locale.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanUiText } from "./uiTextScan";

const SRC = path.resolve(__dirname, "..");

// Each entry is "file\ttext" for a string that is English on purpose, with the reason alongside.
const ALLOWED: Record<string, string> = {
  // Stored phone/email type keys; shown through contactPointLabel() in Portuguese.
  "contacts/EditContactForms.tsx\tWork": "stored key",
  "deals/AddDealPersonColumn.tsx\tWork": "stored key",
  "deals/AddDealPersonColumn.tsx\tMobile": "stored key",
  "deals/AddDealPersonColumn.tsx\tHome": "stored key",
  "deals/AddDealPersonColumn.tsx\tOther": "stored key",
  "entity-create/modalState.ts\tWork": "stored key",
  "quick-add/GlobalContactModal.tsx\tWork": "stored key",
  "deal-workspace/sidebar/PersonBlock.tsx\tPhone": "ContactPointKind discriminant, not copy",
  // Font family names.
  "email/composer/FormatToolbarControls.tsx\tCourier New": "font name",
  "email/composer/FormatToolbarControls.tsx\tTimes New Roman": "font name",
  // Template placeholders are variable names the user types literally.
  "settings/automations/AutomationWizard.tsx\tMensagem (use {{deal.title}}, {{deal.value}}, {{deal.owner}})":
    "placeholder tokens",
  // Machine-facing: OAuth/.well-known protocol endpoints, boot-time operator errors, developer
  // validation messages of an internal schema, a websocket close reason and an inline script.
  "oauth-authorization-server/route.ts\tNot found": "protocol endpoint",
  "oauth-protected-resource/route.ts\tNot found": "protocol endpoint",
  "oauth/authorize/route.ts\tNot found": "protocol endpoint",
  "oauth/register/route.ts\tNot found": "protocol endpoint",
  "oauth/token/route.ts\tNot found": "protocol endpoint",
  "oauth/authorize.ts\tPKCE verifier is invalid": "OAuth error_description",
  "automations/schemas.ts\tdeal_field_changed requires a non-empty triggerConfig.fieldKey":
    "developer validation",
  "automations/schemas.ts\tupdate_field actionConfig.fieldKey must be one of:":
    "developer validation",
  "server/ws/ticket.ts\tUnknown": "log reason",
  "theme/appearance.ts\t(function(){try{ }catch(e){void 0;}})();": "inline script",
  "stats/statsTestHelpers.ts\tCall": "test fixture",
};

function allowed(file: string, text: string): boolean {
  if (file.startsWith("config/env.ts")) return true; // operator-facing boot errors
  return Object.keys(ALLOWED).some((k) => {
    const [f, t] = k.split("\t");
    return f !== undefined && file.endsWith(f) && t === text;
  });
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test(-helpers)?\.tsx?$/.test(e.name)) acc.push(full);
  }
  return acc;
}

describe("pt-BR UI audit", () => {
  it("no user-visible text reads as English", () => {
    const offenders = scanUiText(SRC)
      .filter((h) => !allowed(h.file, h.text))
      .map((h) => `${h.file}:${h.line}  ${JSON.stringify(h.text)}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("dates are formatted in pt-BR, never in the viewer's browser locale", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some((line) => {
            const code = line.replace(/\/\/.*$/, "");
            return /toLocale(Date|Time)?String\(\s*(\)|undefined)/.test(code);
          }),
      )
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
