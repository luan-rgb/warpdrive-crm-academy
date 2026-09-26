import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A temporary copy of drizzle/ whose journal stops right before the migration tagged `tag`, so a
// data test can seed rows in the old shape, then apply the rest and check what the migration did.
// Callers remove the directory when done.
export function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wd-mig-"));
  cpSync("drizzle", dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  const stop = journal.entries.findIndex((e) => e.tag.startsWith(tag));
  journal.entries = journal.entries.slice(0, stop);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}
