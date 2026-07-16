export type DebugEvent = {
  id: string;
  at: string;
  type: string;
  data?: Record<string, unknown>;
};

export const debugEnabledKey = "cadence.debugRecording";
export const debugLogKey = "cadence.debugLog";
const maxEvents = 300;

export function readDebugEvents(value: string | null): DebugEvent[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isDebugEvent).slice(-maxEvents) : [];
  } catch {
    return [];
  }
}

export function appendDebugEvent(events: DebugEvent[], type: string, data?: Record<string, unknown>): DebugEvent[] {
  return [...events, { id: crypto.randomUUID(), at: new Date().toISOString(), type, data }].slice(-maxEvents);
}

function isDebugEvent(value: unknown): value is DebugEvent {
  return Boolean(value && typeof value === "object" && "id" in value && "at" in value && "type" in value);
}
