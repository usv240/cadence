export const defaultFeelings = [
  "I love you",
  "I'm proud of you",
  "Thank you",
  "I'm okay",
  "That means a lot",
  "Ha ha!",
];

export const maxFeelingLength = 120;
const maxFeelings = 12;

export function sanitizeFeelings(value: unknown): string[] {
  if (!Array.isArray(value)) return defaultFeelings;
  const seen = new Set<string>();
  const feelings = value.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || item.length > maxFeelingLength || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxFeelings);
  return feelings.length ? feelings : defaultFeelings;
}
