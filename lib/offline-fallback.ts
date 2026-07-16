import { mockExpand, mockInitiate, mockPredict, mockToneAdjust } from "./mock-language";
import type { Tone, TranscriptInput } from "./conversation";
import type { PersonalProfile } from "./profile";
import type { ConversationMemory } from "./memory";

export function offlinePredict(input: { transcript: TranscriptInput[]; profile?: PersonalProfile; memory?: ConversationMemory; keyword?: string; count?: number }) {
  return mockPredict(input);
}

export function offlineInitiate(input: { transcript: TranscriptInput[]; profile?: PersonalProfile; memory?: ConversationMemory; keyword?: string; count?: number }) {
  return mockInitiate(input);
}

export function offlineExpand(keyword: string, transcript: TranscriptInput[], profile?: PersonalProfile) {
  return mockExpand({ keyword, transcript, profile });
}

export function offlineToneAdjust(text: string, tone: Tone) {
  return mockToneAdjust(text, tone);
}
