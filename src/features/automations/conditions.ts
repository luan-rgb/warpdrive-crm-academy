import { z } from "zod";

// Optional filters on an automation rule (Pipedrive's "conditions" step): the rule only fires when
// the deal, as it stands right after the triggering change, satisfies every condition (AND).
// Stored as automation_rules.conditions jsonb and validated here, the one boundary.

const NUMERIC_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"] as const;
const IDENTITY_OPS = ["eq", "neq"] as const;
const TEXT_OPS = ["contains", "notContains", "eq", "neq"] as const;
const LABEL_OPS = ["contains", "notContains", "isEmpty", "isNotEmpty"] as const;
const DATE_OPS = ["lt", "gt", "isEmpty", "isNotEmpty"] as const;

const isNumeric = (v: string) => v.trim() !== "" && !Number.isNaN(Number(v));
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export const automationConditionSchema = z.discriminatedUnion("field", [
  z
    .object({ field: z.literal("value"), op: z.enum(NUMERIC_OPS), value: z.string() })
    .refine((c) => c.op === "isEmpty" || c.op === "isNotEmpty" || isNumeric(c.value), {
      message: "informe um número",
    }),
  z.object({ field: z.literal("stageId"), op: z.enum(IDENTITY_OPS), value: z.string().min(1) }),
  z.object({ field: z.literal("ownerId"), op: z.enum(IDENTITY_OPS), value: z.string().min(1) }),
  z.object({
    field: z.literal("status"),
    op: z.enum(IDENTITY_OPS),
    value: z.enum(["open", "won", "lost"]),
  }),
  z.object({ field: z.literal("labels"), op: z.enum(LABEL_OPS), value: z.string() }),
  z.object({ field: z.literal("title"), op: z.enum(TEXT_OPS), value: z.string().min(1) }),
  z
    .object({ field: z.literal("expectedCloseDate"), op: z.enum(DATE_OPS), value: z.string() })
    .refine((c) => c.op === "isEmpty" || c.op === "isNotEmpty" || isDate(c.value), {
      message: "informe uma data",
    }),
]);

export const automationConditionsSchema = z.array(automationConditionSchema).max(20);

// Operators each field accepts, in the order the editor offers them.
export const CONDITION_OPS = {
  value: NUMERIC_OPS,
  stageId: IDENTITY_OPS,
  ownerId: IDENTITY_OPS,
  status: IDENTITY_OPS,
  labels: LABEL_OPS,
  title: TEXT_OPS,
  expectedCloseDate: DATE_OPS,
} as const;
export type ConditionField = keyof typeof CONDITION_OPS;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

// The deal columns conditions read. A full deals row satisfies this structurally.
export interface ConditionDeal {
  title: string;
  value: string | null;
  stageId: string;
  ownerId: string;
  status: "open" | "won" | "lost";
  labels: string[];
  expectedCloseDate: string | null;
}

function compare(a: number | string, op: string, b: number | string): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    default:
      return false;
  }
}

// isEmpty/isNotEmpty on a nullable column, or null when the op needs a real comparison.
function emptiness(present: boolean, op: string): boolean | null {
  if (op === "isEmpty") return !present;
  if (op === "isNotEmpty") return present;
  return null;
}

function matchesLabels(labels: string[], op: string, value: string): boolean {
  const empty = emptiness(labels.length > 0, op);
  if (empty !== null) return empty;
  const has = labels.some((l) => l.toLowerCase() === value.toLowerCase());
  return op === "contains" ? has : !has;
}

function matchesTitle(title: string, op: string, value: string): boolean {
  const hay = title.toLowerCase();
  const needle = value.toLowerCase();
  if (op === "contains") return hay.includes(needle);
  if (op === "notContains") return !hay.includes(needle);
  return compare(hay, op, needle);
}

function matchesOne(deal: ConditionDeal, c: AutomationCondition): boolean {
  switch (c.field) {
    case "value":
      return (
        emptiness(deal.value !== null, c.op) ??
        (deal.value !== null && compare(Number(deal.value), c.op, Number(c.value)))
      );
    case "stageId":
    case "ownerId":
    case "status":
      return compare(deal[c.field], c.op, c.value);
    case "labels":
      return matchesLabels(deal.labels, c.op, c.value);
    case "title":
      return matchesTitle(deal.title, c.op, c.value);
    case "expectedCloseDate":
      // ISO dates compare correctly as strings.
      return (
        emptiness(deal.expectedCloseDate !== null, c.op) ??
        (deal.expectedCloseDate !== null && compare(deal.expectedCloseDate, c.op, c.value))
      );
  }
}

export function dealMatchesConditions(
  deal: ConditionDeal,
  conditions: readonly AutomationCondition[],
): boolean {
  return conditions.every((c) => matchesOne(deal, c));
}
