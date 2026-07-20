import { sanitizeConversationSettings, type ConversationSettings } from "./conversation-settings";

export type ConversationKit = {
  id: string;
  name: string;
  settings: ConversationSettings;
};

export const conversationKitsKey = "cadence.conversationKits";
const maxKits = 8;

export function sanitizeConversationKits(value: unknown): ConversationKit[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((kit) => {
    if (!kit || typeof kit !== "object") return [];
    const source = kit as Partial<ConversationKit>;
    const name = typeof source.name === "string" ? source.name.trim().slice(0, 40) : "";
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ id: typeof source.id === "string" && source.id ? source.id.slice(0, 80) : crypto.randomUUID(), name, settings: sanitizeConversationSettings(source.settings) }];
  }).slice(0, maxKits);
}
