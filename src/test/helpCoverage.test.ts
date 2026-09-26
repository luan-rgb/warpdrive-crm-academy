// Every page heading carries a "?" explaining the page (Tarefa 5): a heading without help= fails
// here, so a new page cannot ship without its explanation.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..", "app");

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(full, acc);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) acc.push(full);
  }
  return acc;
}

// Each `<PageHeading ...>` / `<SettingsHeading ...>` opening tag, up to its closing ">".
const HEADING = /<(PageHeading|SettingsHeading)\b([^>]|=>)*?\/?>/gs;

describe("help coverage", () => {
  it("every page heading has a help topic", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(APP)) {
      if (file.endsWith("SettingsHeading.tsx")) continue; // the wrapper forwards help itself
      for (const m of readFileSync(file, "utf8").matchAll(HEADING)) {
        if (!/\bhelp=/.test(m[0]))
          missing.push(`${path.relative(APP, file)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
