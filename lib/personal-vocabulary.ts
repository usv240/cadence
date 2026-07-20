export type PersonalVocabularyEntry = {
  heardAs: string;
  writeAs: string;
};

export const personalVocabularyKey = "cadence.personalVocabulary";
const maxEntries = 24;
const maxEntryLength = 60;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, maxEntryLength) : "";
}

export function sanitizePersonalVocabulary(value: unknown): PersonalVocabularyEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<PersonalVocabularyEntry>;
    const heardAs = clean(candidate.heardAs);
    const writeAs = clean(candidate.writeAs);
    const key = heardAs.toLocaleLowerCase();
    if (!heardAs || !writeAs || seen.has(key)) return [];
    seen.add(key);
    return [{ heardAs, writeAs }];
  }).slice(0, maxEntries);
}

export function applyPersonalVocabulary(text: string, vocabulary: PersonalVocabularyEntry[]) {
  return vocabulary
    .slice()
    .sort((first, second) => second.heardAs.length - first.heardAs.length)
    .reduce((result, entry) => result.replace(new RegExp(`\\b${escapeRegExp(entry.heardAs)}\\b`, "gi"), entry.writeAs), text);
}

export function parsePersonalVocabulary(value: string) {
  return sanitizePersonalVocabulary(value.split("\n").map((line) => {
    const [heardAs, ...rest] = line.split("=");
    return { heardAs, writeAs: rest.join("=") };
  }));
}

export function formatPersonalVocabulary(vocabulary: PersonalVocabularyEntry[]) {
  return vocabulary.map(({ heardAs, writeAs }) => `${heardAs} = ${writeAs}`).join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
