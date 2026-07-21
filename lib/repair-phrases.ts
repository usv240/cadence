export const repairPhrasesKey = "cadence.repairPhrases";

export const defaultRepairPhrases = [
  "That is not what I meant.",
  "Please repeat that.",
  "Let me say that another way.",
  "I want to add something.",
];

export const maxRepairPhraseLength = 120;
const maxRepairPhrases = 12;

export function sanitizeRepairPhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return defaultRepairPhrases;
  const seen = new Set<string>();
  const phrases = value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || item.length > maxRepairPhraseLength || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxRepairPhrases);
  return phrases.length ? phrases : defaultRepairPhrases;
}
