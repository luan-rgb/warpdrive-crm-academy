import { z } from "zod";
import {
  ACTIVITY_ACTIONS,
  DEAL_ACTIONS,
  GOAL_ACTIONS,
  GOAL_ASSIGNEE_KINDS,
  GOAL_INTERVALS,
  GOAL_METRICS,
  GOAL_SUBJECTS,
} from "@/constants/goals";

// Target arrives as a decimal string so it survives the round trip to numeric(14,2) without
// a float in the middle.
const target = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0, { message: "target must be greater than zero" });

const shape = z.object({
  subject: z.enum(GOAL_SUBJECTS),
  action: z.enum(GOAL_ACTIONS),
  metric: z.enum(GOAL_METRICS),
  assigneeKind: z.enum(GOAL_ASSIGNEE_KINDS),
  assigneeId: z.string().uuid().nullable().default(null),
  pipelineId: z.string().uuid().nullable().default(null),
  activityTypeId: z.string().uuid().nullable().default(null),
  interval: z.enum(GOAL_INTERVALS),
  target,
  startsOn: z.string().date(),
  endsOn: z.string().date().nullable().default(null),
});

// Not every combination of the enums describes a real goal, and the database cannot express
// the dependency between two columns' values. The boundary is where they are rejected.
export const goalInput = shape
  .refine((g) => (g.subject === "deal" ? DEAL_ACTIONS.includes(g.action) : true), {
    message: "uma meta de negócios conta negócios adicionados, ganhos ou perdidos",
    path: ["action"],
  })
  .refine((g) => (g.subject === "activity" ? ACTIVITY_ACTIONS.includes(g.action) : true), {
    message: "uma meta de atividades conta atividades adicionadas ou concluídas",
    path: ["action"],
  })
  // An activity carries no monetary value, so a value target on one has nothing to measure.
  .refine((g) => !(g.subject === "activity" && g.metric === "value"), {
    message: "atividades não têm valor para somar",
    path: ["metric"],
  })
  .refine((g) => !(g.subject === "deal" && g.activityTypeId !== null), {
    message: "um tipo de atividade não se aplica a uma meta de negócios",
    path: ["activityTypeId"],
  })
  .refine((g) => (g.assigneeKind === "company") === (g.assigneeId === null), {
    message: "uma meta da empresa não tem responsável; uma meta de usuário ou equipe precisa de um",
    path: ["assigneeId"],
  })
  // A count goal advances one whole deal or activity at a time, so a fractional target is a
  // quota that can never be met exactly.
  .refine((g) => g.metric !== "count" || Number.isInteger(Number(g.target)), {
    message: "uma meta de quantidade precisa ser um número inteiro",
    path: ["target"],
  })
  .refine((g) => g.endsOn === null || g.endsOn >= g.startsOn, {
    message: "uma meta não pode terminar antes de começar",
    path: ["endsOn"],
  });

export type GoalInput = z.infer<typeof goalInput>;
