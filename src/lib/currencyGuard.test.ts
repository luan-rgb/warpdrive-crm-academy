// Repo-wide guard for the BRL requirement: every money amount on screen goes through
// src/lib/formatCurrency.ts (pt-BR, BRL by default), so no screen can drift to dollars or to a
// hand-rolled format again. Scans source text, so it also catches code no other test renders.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test(-helpers)?\.tsx?$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const FILES = sourceFiles(ROOT).map((f) => ({
  rel: path.relative(ROOT, f),
  text: readFileSync(f, "utf8"),
}));

describe("currency formatting guard", () => {
  it("formats money only through src/lib/formatCurrency.ts", () => {
    const offenders = FILES.filter(
      (f) =>
        f.rel !== path.join("lib", "formatCurrency.ts") && /style:\s*["']currency["']/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  // dayLoad.ts only probes whether a time zone name is valid (no output is shown), so its en-US
  // is not a display format.
  const NOT_DISPLAY = new Set([path.join("features", "activities", "dayLoad.ts")]);

  it("never hardcodes dollars or a US number/date format", () => {
    const offenders = FILES.filter(
      (f) => !NOT_DISPLAY.has(f.rel) && /["'](USD|en-US)["']/.test(f.text),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
