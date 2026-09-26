import { lt } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_AUDIT_RETENTION } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { db as defaultDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { safeErrorSummary } from "@/lib/safeError";

type SecurityTarget = "session" | "oauth_client" | "mailbox" | "export";

export interface SecurityEventInput {
  actorId: string | null;
  targetType: SecurityTarget;
  targetId: string | null;
  // Dotted verb, e.g. "auth.login", "oauth.revoke". Details go in `detail`, never secrets or
  // the attempted e-mail address of a failed login.
  action: string;
  detail?: Record<string, unknown>;
}

// Audit is evidence, not a gate: a failed insert is logged and swallowed so it can never turn a
// sign-in, sign-out or connection into an error for the user.
export async function recordSecurityEvent(db: Db, event: SecurityEventInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      actorId: event.actorId,
      targetType: event.targetType,
      targetId: event.targetId,
      action: event.action,
      after: event.detail ?? null,
    });
  } catch (e) {
    console.error("[audit] could not record security event", event.action, safeErrorSummary(e));
  }
}

// A year covers any investigation this CRM realistically needs and keeps the table (which holds
// user ids and timestamps, i.e. personal data under LGPD) from growing forever.
const RETENTION_DAYS = 365;

export async function purgeOldAuditEvents(db: Db, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(auditEvents)
    .where(lt(auditEvents.createdAt, cutoff))
    .returning({ id: auditEvents.id });
  return removed.length;
}

export async function registerAuditRetentionJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_AUDIT_RETENTION);
  await boss.work(PGBOSS_QUEUE_AUDIT_RETENTION, async () => {
    await purgeOldAuditEvents(defaultDb, AbortSignal.timeout(5 * 60 * 1000));
  });
  // Daily, off the hour so it does not pile onto the hourly jobs.
  await boss.schedule(PGBOSS_QUEUE_AUDIT_RETENTION, "17 3 * * *");
}
