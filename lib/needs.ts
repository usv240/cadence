export const defaultNeeds = [
  "I'm uncomfortable",
  "I'm in pain",
  "Please come here",
  "I need to be repositioned",
  "I need suction",
  "Give me a moment",
];

const maxNeeds = 16;
const maxNeedLength = 120;

export function sanitizeNeeds(value: unknown): string[] {
  if (!Array.isArray(value)) return defaultNeeds;
  const seen = new Set<string>();
  const needs = value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || item.length > maxNeedLength || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxNeeds);
  return needs.length ? needs : defaultNeeds;
}

export { maxNeedLength };
