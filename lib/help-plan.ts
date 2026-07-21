export const helpPlanKey = "cadence.helpPlan";
export const maxHelpPlanLength = 280;

export type HelpPlan = {
  instruction: string;
};

export const emptyHelpPlan: HelpPlan = { instruction: "" };

export function sanitizeHelpPlan(value: unknown): HelpPlan {
  if (!value || typeof value !== "object") return emptyHelpPlan;
  const source = value as { instruction?: unknown };
  return {
    instruction: typeof source.instruction === "string" ? source.instruction.trim().slice(0, maxHelpPlanLength) : "",
  };
}
