import { mockTranscribe } from "./mock-language";
import type { Candidate, Tone, TranscriptInput, TranscriptTurn } from "./conversation";
import type { ExpandOutput } from "./expand";
import type { PredictOutput } from "./predict";
import type { ToneAdjustOutput } from "./toneAdjust";
import type { StyleInput, StyleOutput } from "./style-card";
import type { PersonalProfile } from "./profile";

export interface ConversationService {
  predict(input: { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; keyword?: string; n?: number }, signal?: AbortSignal): Promise<PredictOutput>;
  expand(input: { keyword: string; transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile }): Promise<ExpandOutput>;
  toneAdjust(input: { text: string; tone: Tone }): Promise<ToneAdjustOutput>;
  style(input: StyleInput): Promise<StyleOutput>;
  speak(text: string, tone: Tone): Promise<void>;
  transcribe(previousText?: string): Promise<TranscriptTurn>;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: "Unable to generate a reply." })) as { error?: string };
    throw new Error(detail.error ?? "Unable to generate a reply.");
  }
  return response.json() as Promise<T>;
}

export const conversationService: ConversationService = {
  predict: (input, signal) => postJson<PredictOutput>("/api/predict", input, signal),
  expand: (input) => postJson<ExpandOutput>("/api/expand", input),
  toneAdjust: (input) => postJson<ToneAdjustOutput>("/api/tone", input),
  style: (input) => postJson<StyleOutput>("/api/style", input),
  async speak(text, tone) {
    const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, tone }) });
    if (response.status === 204) {
      console.log("Cadence speaks:", text);
      return;
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ error: "Unable to speak this reply." })) as { error?: string };
      throw new Error(detail.error ?? "Unable to speak this reply.");
    }
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  },
  async transcribe(previousText) {
    return mockTranscribe(previousText);
  },
};

export function candidatesToSuggestions(candidates: Candidate[]) {
  const accents = ["mint", "sky", "peach", "lilac"] as const;
  return candidates.map((candidate, index) => ({ id: `${candidate.intent}-${index}`, label: candidate.intent === "redirect" ? "Redirect" : candidate.intent === "joke" ? "Joke" : candidate.intent === "ask" ? "Ask more" : candidate.intent === "agree" ? "Agree" : candidate.intent === "react" ? "React" : "Reply", text: candidate.text, accent: accents[index % accents.length] }));
}
