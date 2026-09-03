"use server";

import type { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { can } from "@/features/permissions/can";
import { createContext } from "@/server/trpc/context";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationRuleActive,
  updateAutomationRule,
} from "./rulesRepo";
import {
  createAutomationRuleInputSchema,
  deleteAutomationRuleInputSchema,
  setAutomationRuleActiveInputSchema,
  updateAutomationRuleInputSchema,
} from "./schemas";

type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { id: string } };

async function gateAutomationManage(
  csrfToken: string | null,
): Promise<{ ok: true; actorId: string } | { ok: false; error: { id: string } }> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };
  if (!can(actor, "automation.manage")) return { ok: false, error: { id: ERROR_IDS.PERM_DENIED } };
  return { ok: true, actorId: actor.id };
}

export async function createAutomationRuleAction(
  input: z.input<typeof createAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = createAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await createAutomationRule(db, g.actorId, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function updateAutomationRuleAction(
  input: z.input<typeof updateAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = updateAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await updateAutomationRule(db, parsed.data, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function setAutomationRuleActiveAction(
  input: z.input<typeof setAutomationRuleActiveInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = setAutomationRuleActiveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await setAutomationRuleActive(db, parsed.data.id, parsed.data.isActive, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}

export async function deleteAutomationRuleAction(
  input: z.input<typeof deleteAutomationRuleInputSchema>,
  csrfToken: string | null = null,
): Promise<ActionResult<unknown>> {
  const g = await gateAutomationManage(csrfToken);
  if (!g.ok) return g;
  const parsed = deleteAutomationRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.AUTOMATION_INPUT_INVALID } };
  const result = await deleteAutomationRule(db, parsed.data.id, SIG());
  if (!result.ok) return { ok: false, error: { id: result.error.id } };
  return { ok: true, value: result.value };
}
