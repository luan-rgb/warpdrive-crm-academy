import {
  GOAL_INTERVAL_LABELS,
  type GoalAction,
  type GoalInterval,
  type GoalMetric,
  type GoalSubject,
} from "@/constants/goals";

// Gendered by subject: "added" agrees with masculine "negócios" and feminine "atividades".
const DEAL_ACTION_WORD: Partial<Record<GoalAction, string>> = {
  added: "adicionados",
  won: "ganhos",
  lost: "perdidos",
};
const ACTIVITY_ACTION_WORD: Partial<Record<GoalAction, string>> = {
  added: "adicionadas",
  completed: "concluídas",
};

// A goal has no name of its own; what it measures is its name. "Valor de negócios ganhos, mensal"
// says more than any label a user would have typed.
export function goalLabel(goal: {
  subject: GoalSubject;
  action: GoalAction;
  metric: GoalMetric;
  interval: GoalInterval;
}): string {
  const noun =
    goal.subject === "deal"
      ? goal.metric === "value"
        ? "Valor de negócios"
        : "Negócios"
      : "Atividades";
  const actionWord =
    goal.subject === "deal" ? DEAL_ACTION_WORD[goal.action] : ACTIVITY_ACTION_WORD[goal.action];
  return `${noun} ${actionWord}, ${GOAL_INTERVAL_LABELS[goal.interval]}`;
}
