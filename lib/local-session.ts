import type { SpokenItem, Suggestion, TranscriptTurn } from "./conversation";

export const localSessionKey = "cadence.session";
/** Conversation text is kept on this device for one day, then removed automatically. */
export const LOCAL_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type LocalSession = {
  savedAt: number;
  transcript: TranscriptTurn[];
  spoken: SpokenItem[];
  suggestions: Suggestion[];
  baseSuggestions: Suggestion[];
  suggestionMode: "reply" | "initiate";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuggestion(value: unknown): value is Suggestion {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string" && typeof value.text === "string" && ["mint", "peach", "sky", "lilac"].includes(String(value.accent));
}

function isTurn(value: unknown): value is TranscriptTurn {
  return isRecord(value) && typeof value.id === "string" && typeof value.speaker === "string" && typeof value.text === "string" && typeof value.time === "string" && ["orange", "blue", "pink"].includes(String(value.color));
}

function isSpokenItem(value: unknown): value is SpokenItem {
  return isRecord(value) && typeof value.id === "string" && typeof value.text === "string" && typeof value.time === "string" && isRecord(value.impact) && typeof value.impact.secondsSaved === "number";
}

export function readLocalSession(raw: string | null, now = Date.now()): LocalSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as unknown;
    if (!isRecord(session) || typeof session.savedAt !== "number" || now - session.savedAt > LOCAL_SESSION_TTL_MS || now < session.savedAt || !Array.isArray(session.transcript) || !Array.isArray(session.spoken) || !Array.isArray(session.suggestions) || !Array.isArray(session.baseSuggestions) || (session.suggestionMode !== "reply" && session.suggestionMode !== "initiate")) return null;
    if (!session.transcript.every(isTurn) || !session.spoken.every(isSpokenItem) || !session.suggestions.every(isSuggestion) || !session.baseSuggestions.every(isSuggestion)) return null;
    return { savedAt: session.savedAt, transcript: session.transcript.slice(-5), spoken: session.spoken.slice(0, 50), suggestions: session.suggestions.slice(0, 4), baseSuggestions: session.baseSuggestions.slice(0, 4), suggestionMode: session.suggestionMode };
  } catch {
    return null;
  }
}
