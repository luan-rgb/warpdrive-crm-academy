// The deploy script only runs on the VPS, where a mistake in its order (migrating a tenant before
// the shared stack is up, skipping the backup) costs real student data. Its --dry-run prints the
// commands instead of running them, so the order is pinned here without Docker.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let root = "";

function fakeRepo(slugs: string[]): string {
  root = mkdtempSync(path.join(tmpdir(), "wd-update-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "envs"));
  copyFileSync("scripts/update-all-tenants.sh", path.join(root, "scripts/update-all-tenants.sh"));
  writeFileSync(path.join(root, "envs/shared.env"), "BASE_DOMAIN=crm.example.com\n");
  for (const slug of slugs) writeFileSync(path.join(root, `envs/aluno-${slug}.env`), "X=1\n");
  return root;
}

function dryRun(repo: string, ...args: string[]): string[] {
  const out = execFileSync(
    "bash",
    [path.join(repo, "scripts/update-all-tenants.sh"), "--dry-run", ...args],
    {
      encoding: "utf8",
    },
  );
  return out.split("\n").filter((l) => l.startsWith("+ "));
}

afterEach(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("scripts/update-all-tenants.sh --dry-run", () => {
  it("backs up first, then the shared stack, then env sync, then each tenant, then health checks", () => {
    const cmds = dryRun(fakeRepo(["ana", "bruno"]));
    const at = (needle: string) => cmds.findIndex((c) => c.includes(needle));

    expect(at("scripts/backup-tenants.sh")).toBe(0);
    expect(at("-p tenants-shared")).toBeGreaterThan(at("scripts/backup-tenants.sh"));
    expect(at("scripts/sync-mail-oauth-env.sh")).toBeGreaterThan(at("-p tenants-shared"));
    expect(at("-p aluno-ana")).toBeGreaterThan(at("scripts/sync-mail-oauth-env.sh"));
    expect(at("-p aluno-bruno")).toBeGreaterThan(at("-p aluno-ana"));
    expect(at("https://ana.crm.example.com/api/health")).toBeGreaterThan(at("-p aluno-bruno"));
    expect(cmds.some((c) => c.includes("--env-file envs/aluno-ana.env up -d --build"))).toBe(true);
  });

  it("--only updates just one tenant (the shared stack still first)", () => {
    const cmds = dryRun(fakeRepo(["ana", "bruno"]), "--only", "bruno");
    expect(cmds.some((c) => c.includes("-p aluno-bruno"))).toBe(true);
    expect(cmds.some((c) => c.includes("-p aluno-ana"))).toBe(false);
    expect(cmds.some((c) => c.includes("-p tenants-shared"))).toBe(true);
  });

  it("refuses an --only slug that has no env file", () => {
    expect(() => dryRun(fakeRepo(["ana"]), "--only", "nobody")).toThrow();
  });
});
