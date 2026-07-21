export type ConversationMode = "family" | "care" | "doctor" | "work" | "friends";
export type EnergyLevel = "low" | "normal" | "good";
export const supportedLanguages = ["en-US", "es-ES", "fr-FR", "hi-IN"] as const;
export type ConversationLanguage = typeof supportedLanguages[number];

export type ConversationSettings = {
  mode: ConversationMode;
  energy: EnergyLevel;
  peopleHere: string[];
  topicsToAvoid: string[];
  phrasesToAvoid: string[];
  scanIntervalMs: number;
  privateSession: boolean;
  language: ConversationLanguage;
  preserveWording: boolean;
};

export const defaultConversationSettings: ConversationSettings = {
  mode: "family",
  energy: "normal",
  peopleHere: [],
  topicsToAvoid: [],
  phrasesToAvoid: [],
  scanIntervalMs: 1200,
  privateSession: false,
  language: "en-US",
  preserveWording: true,
};

const maxItems = 12;
const scanIntervals = [900, 1200, 1800] as const;

function cleanList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.localeCompare(item, undefined, { sensitivity: "accent" }) === 0) === index)
    .slice(0, maxItems);
}

export function sanitizeConversationSettings(value: unknown): ConversationSettings {
  if (!value || typeof value !== "object") return defaultConversationSettings;
  const source = value as Partial<ConversationSettings>;
  const mode: ConversationMode = ["family", "care", "doctor", "work", "friends"].includes(source.mode ?? "") ? source.mode as ConversationMode : defaultConversationSettings.mode;
  const energy: EnergyLevel = ["low", "normal", "good"].includes(source.energy ?? "") ? source.energy as EnergyLevel : defaultConversationSettings.energy;
  return {
    mode,
    energy,
    peopleHere: cleanList(source.peopleHere),
    topicsToAvoid: cleanList(source.topicsToAvoid),
    phrasesToAvoid: cleanList(source.phrasesToAvoid),
    scanIntervalMs: scanIntervals.includes(source.scanIntervalMs as typeof scanIntervals[number]) ? source.scanIntervalMs as number : defaultConversationSettings.scanIntervalMs,
    privateSession: Boolean(source.privateSession),
    language: supportedLanguages.includes(source.language as ConversationLanguage) ? source.language as ConversationLanguage : defaultConversationSettings.language,
    preserveWording: source.preserveWording !== false,
  };
}

export function settingsToContext(settings: ConversationSettings) {
  return {
    mode: settings.mode,
    energy: settings.energy,
    peopleHere: settings.peopleHere,
    topicsToAvoid: settings.topicsToAvoid,
    phrasesToAvoid: settings.phrasesToAvoid,
    language: settings.language,
    preserveWording: settings.preserveWording,
  };
}

export function validateConversationSettings(value: unknown) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return "conversation settings must be an object.";
  const source = value as Record<string, unknown>;
  for (const key of ["peopleHere", "topicsToAvoid", "phrasesToAvoid"] as const) {
    const list = source[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > maxItems || list.some((item) => typeof item !== "string" || item.length > 80))) return `${key} is invalid.`;
  }
  return null;
}
