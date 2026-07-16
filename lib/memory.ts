import type { TranscriptInput } from "./conversation";

export type ConversationMemory = {
  people: string[];
  topics: string[];
};

export const emptyConversationMemory: ConversationMemory = { people: [], topics: [] };

const maxItems = 12;
const stopWords = new Set(["about", "after", "again", "also", "been", "being", "could", "does", "doing", "from", "have", "into", "just", "like", "make", "more", "next", "really", "should", "some", "that", "their", "there", "they", "this", "today", "what", "when", "where", "which", "with", "would", "your"]);

function distinct(values: string[], normalize: (value: string) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-maxItems);
}

export function updateConversationMemory(current: ConversationMemory, turns: TranscriptInput[]): ConversationMemory {
  const names = turns.flatMap((turn) => [turn.speaker, ...(turn.text.match(/\b[A-Z][a-z]{1,}\b/g) ?? [])]).filter((name) => name !== "Room");
  const topics = turns.flatMap((turn) => turn.text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((word) => !stopWords.has(word));
  return {
    people: distinct([...current.people, ...names], (value) => value.toLowerCase()),
    topics: distinct([...current.topics, ...topics], (value) => value.toLowerCase()),
  };
}

export function validateConversationMemory(memory: unknown): string | null {
  if (memory === undefined) return null;
  if (!memory || typeof memory !== "object") return "memory must be an object.";
  const candidate = memory as Record<string, unknown>;
  for (const key of ["people", "topics"] as const) {
    const values = candidate[key];
    if (!Array.isArray(values) || values.length > maxItems || !values.every((value) => typeof value === "string" && value.length <= 60)) return `memory.${key} must contain up to ${maxItems} short strings.`;
  }
  return null;
}
