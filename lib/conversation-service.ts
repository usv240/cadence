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
import type { TtsVoice } from "./voices";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let completeActiveAudio: (() => void) | null = null;
let completeDeviceSpeech: (() => void) | null = null;
const STREAMING_AUDIO_MIME = "audio/mpeg";

export class RealModeConsentRequiredError extends Error {
  constructor() {
    super("Real-mode consent is required.");
    this.name = "RealModeConsentRequiredError";
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("Cadence is taking longer than expected. Please try again, or use local replies.");
    this.name = "RequestTimeoutError";
  }
}

function realModeConsentRequired() {
  window.dispatchEvent(new Event("cadence:real-mode-consent-required"));
  return new RealModeConsentRequiredError();
}

function requestHeaders() {
  return {
    "Content-Type": "application/json",
    "x-cadence-model-consent": window.localStorage.getItem("cadence.realModeConsent") === "1" ? "1" : "0",
  };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function speakWithDevice(text: string, tone: Tone, delivery?: "needs", onPlaybackStarted?: () => void) {
  if (!("speechSynthesis" in window)) throw new Error("Speech is unavailable offline on this device.");
  completeDeviceSpeech?.();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = delivery === "needs" || tone === "firm" ? 0.9 : 1;
  utterance.pitch = tone === "funny" ? 1.08 : 1;
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (completeDeviceSpeech === finish) completeDeviceSpeech = null;
      resolve();
    };
    completeDeviceSpeech = finish;
    utterance.onend = finish;
    utterance.onerror = () => {
      if (completeDeviceSpeech === finish) completeDeviceSpeech = null;
      reject(new Error("Device speech playback failed."));
    };
    window.speechSynthesis.speak(utterance);
    onPlaybackStarted?.();
  });
}

function clearActiveAudio() {
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudio = null;
  activeAudioUrl = null;
  completeActiveAudio = null;
}

function canStreamAudio(contentType: string) {
  return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(contentType);
}

async function playStreamedAudio(response: Response, onPlaybackStarted?: () => void) {
  const stream = response.body;
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0] || STREAMING_AUDIO_MIME;
  if (!stream || !canStreamAudio(contentType)) return false;

  const mediaSource = new MediaSource();
  activeAudioUrl = URL.createObjectURL(mediaSource);
  const audio = new Audio(activeAudioUrl);
  activeAudio = audio;

  const ended = new Promise<void>((resolve, reject) => {
    completeActiveAudio = resolve;
    audio.onended = () => { clearActiveAudio(); resolve(); };
    audio.onerror = () => { clearActiveAudio(); reject(new Error("Audio playback failed.")); };
  });
  const sourceOpened = new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
    mediaSource.addEventListener("error", () => reject(new Error("Streaming audio is unavailable.")), { once: true });
  });

  try {
    await sourceOpened;
    const sourceBuffer = mediaSource.addSourceBuffer(contentType);
    const reader = stream.getReader();
    const append = async (chunk: Uint8Array) => {
      await new Promise<void>((resolve, reject) => {
        sourceBuffer.addEventListener("updateend", () => resolve(), { once: true });
        sourceBuffer.addEventListener("error", () => reject(new Error("Audio buffering failed.")), { once: true });
        sourceBuffer.appendBuffer(chunk);
      });
    };
    const first = await reader.read();
    if (first.done || !first.value) throw new Error("No audio was returned.");
    await append(first.value);
    await audio.play();
    onPlaybackStarted?.();
    void (async () => {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done || activeAudio !== audio) break;
          if (chunk.value) await append(chunk.value);
        }
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
      } catch {
        if (mediaSource.readyState === "open") mediaSource.endOfStream("network");
      }
    })();
    await ended;
    return true;
  } catch (error) {
    if (activeAudio === audio) {
      audio.pause();
      clearActiveAudio();
    }
    throw error;
  }
}

export interface ConversationService {
  predict(input: { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; feedback?: "more_like_me"; keyword?: string; n?: number }, signal?: AbortSignal): Promise<PredictOutput>;
  initiate(input: { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; keyword?: string; n?: number }): Promise<InitiateOutput>;
  expand(input: { keyword: string; transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile }): Promise<ExpandOutput>;
  toneAdjust(input: { text: string; tone: Tone }): Promise<ToneAdjustOutput>;
  style(input: StyleInput): Promise<StyleOutput>;
  speak(text: string, tone: Tone, delivery?: "needs", voice?: TtsVoice, onPlaybackStarted?: () => void, useDeviceVoice?: boolean): Promise<void>;
  stopSpeaking(): void;
  transcribe(previousText?: string): Promise<TranscriptTurn>;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(path, { method: "POST", headers: requestHeaders(), body: JSON.stringify(body) }, 25_000, signal);
  if (response.status === 428) throw realModeConsentRequired();
  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    throw new Error(Number.isFinite(retryAfterSeconds) ? `Cadence needs a short pause. Try again in ${retryAfterSeconds} seconds.` : "Cadence needs a short pause. Please try again shortly.");
  }
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
  async speak(text, tone, delivery, voice, onPlaybackStarted, useDeviceVoice = false) {
    if (useDeviceVoice || !navigator.onLine) {
      speakWithDevice(text, tone, delivery, onPlaybackStarted);
      return;
    }
    let response: Response;
    try {
      response = await fetchWithTimeout("/api/speak", { method: "POST", headers: requestHeaders(), body: JSON.stringify({ text, tone, delivery, voice }) }, 35_000);
    } catch {
      speakWithDevice(text, tone, delivery, onPlaybackStarted);
      return;
    }
    if (response.status === 204) {
      return;
    }
    if (response.status === 428) throw realModeConsentRequired();
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      throw new Error(Number.isFinite(retryAfterSeconds) ? `Cadence needs a short pause. Try speech again in ${retryAfterSeconds} seconds.` : "Cadence needs a short pause. Please try speech again shortly.");
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ error: "Unable to speak this reply." })) as { error?: string };
      throw new Error(detail.error ?? "Unable to speak this reply.");
    }
    this.stopSpeaking();
    if (await playStreamedAudio(response, onPlaybackStarted)) return;
    activeAudioUrl = URL.createObjectURL(await response.blob());
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.onended = clearActiveAudio;
    activeAudio.onerror = clearActiveAudio;
    await activeAudio.play();
    onPlaybackStarted?.();
    await new Promise<void>((resolve, reject) => {
      completeActiveAudio = resolve;
      if (!activeAudio) { resolve(); return; }
      activeAudio.onended = () => { clearActiveAudio(); resolve(); };
      activeAudio.onerror = () => { clearActiveAudio(); reject(new Error("Audio playback failed.")); };
    });
  },
  stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      completeDeviceSpeech?.();
    }
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
