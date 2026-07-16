export type ReplyPreferences = {
  previewBeforeSpeaking: boolean;
  blockedPhrases: string[];
  favorites: string[];
};

export const emptyReplyPreferences: ReplyPreferences = {
  previewBeforeSpeaking: true,
  blockedPhrases: [],
  favorites: [],
};

const maxItems = 24;

export function sanitizeReplyPreferences(value: unknown): ReplyPreferences {
  if (!value || typeof value !== "object") return emptyReplyPreferences;
  const source = value as Partial<ReplyPreferences>;
  return {
    previewBeforeSpeaking: source.previewBeforeSpeaking === undefined ? true : Boolean(source.previewBeforeSpeaking),
    blockedPhrases: cleanItems(source.blockedPhrases),
    favorites: cleanItems(source.favorites),
  };
}

function cleanItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || item.length > 600 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-maxItems);
}
