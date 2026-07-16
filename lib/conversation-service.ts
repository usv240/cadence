import { mockTranscribe } from "./mock-language";
import type { Candidate, Tone, TranscriptInput, TranscriptTurn } from "./conversation";
import type { ExpandOutput } from "./expand";
import type { InitiateOutput } from "./initiate";
import type { PredictOutput } from "./predict";
import type { ToneAdjustOutput } from "./toneAdjust";
import type { StyleInput, StyleOutput } from "./style-card";
import type { PersonalProfile } from "./profile";
import type { ConversationMemory } from "./memory";
import type { ConversationSettings } from "./conversation-settings";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let completeActiveAudio: (() => void) | null = null;

function requestHeaders() {
  return {
    "Content-Type": "application/json",
    "x-cadence-model-consent": window.localStorage.getItem("cadence.realModeConsent") === "1" ? "1" : "0",
  };
}

function speakWithDevice(text: string, tone: Tone, delivery?: "needs") {
  if (!("speechSynthesis" in window)) throw new Error("Speech is unavailable offline on this device.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = delivery === "needs" || tone === "firm" ? 0.9 : 1;
  utterance.pitch = tone === "funny" ? 1.08 : 1;
  window.speechSynthesis.speak(utterance);
}

function clearActiveAudio() {
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudio = null;
  activeAudioUrl = null;
  completeActiveAudio = null;
}

export interface ConversationService {
  predict(input: { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; feedback?: "more_like_me"; keyword?: string; n?: number }, signal?: AbortSignal): Promise<PredictOutput>;
  initiate(input: { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; keyword?: string; n?: number }): Promise<InitiateOutput>;
  expand(input: { keyword: string; transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile }): Promise<ExpandOutput>;
  toneAdjust(input: { text: string; tone: Tone }): Promise<ToneAdjustOutput>;
  style(input: StyleInput): Promise<StyleOutput>;
  speak(text: string, tone: Tone, delivery?: "needs"): Promise<void>;
  stopSpeaking(): void;
  transcribe(previousText?: string): Promise<TranscriptTurn>;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: requestHeaders(), body: JSON.stringify(body), signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: "Unable to generate a reply." })) as { error?: string };
    throw new Error(detail.error ?? "Unable to generate a reply.");
  }
  return response.json() as Promise<T>;
}

export const conversationService: ConversationService = {
  predict: (input, signal) => postJson<PredictOutput>("/api/predict", input, signal),
  initiate: (input) => postJson<InitiateOutput>("/api/initiate", input),
  expand: (input) => postJson<ExpandOutput>("/api/expand", input),
  toneAdjust: (input) => postJson<ToneAdjustOutput>("/api/tone", input),
  style: (input) => postJson<StyleOutput>("/api/style", input),
  async speak(text, tone, delivery) {
    if (!navigator.onLine) {
      speakWithDevice(text, tone, delivery);
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/speak", { method: "POST", headers: requestHeaders(), body: JSON.stringify({ text, tone, delivery }) });
    } catch {
      speakWithDevice(text, tone, delivery);
      return;
    }
    if (response.status === 204) {
      return;
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ error: "Unable to speak this reply." })) as { error?: string };
      throw new Error(detail.error ?? "Unable to speak this reply.");
    }
    this.stopSpeaking();
    activeAudioUrl = URL.createObjectURL(await response.blob());
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.onended = clearActiveAudio;
    activeAudio.onerror = clearActiveAudio;
    await activeAudio.play();
    await new Promise<void>((resolve, reject) => {
      completeActiveAudio = resolve;
      if (!activeAudio) { resolve(); return; }
      activeAudio.onended = () => { clearActiveAudio(); resolve(); };
      activeAudio.onerror = () => { clearActiveAudio(); reject(new Error("Audio playback failed.")); };
    });
  },
  stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (!activeAudio) return;
    activeAudio.pause();
    activeAudio.currentTime = 0;
    completeActiveAudio?.();
    clearActiveAudio();
  },
  async transcribe(previousText) {
    return mockTranscribe(previousText);
  },
};

export function candidatesToSuggestions(candidates: Candidate[]) {
  const accents = ["mint", "sky", "peach", "lilac"] as const;
  return candidates.map((candidate, index) => ({ id: `${candidate.intent}-${index}`, label: candidate.intent === "redirect" ? "Redirect" : candidate.intent === "joke" ? "Joke" : candidate.intent === "ask" ? "Ask more" : candidate.intent === "agree" ? "Agree" : candidate.intent === "react" ? "React" : "Reply", text: candidate.text, accent: accents[index % accents.length] }));
}
