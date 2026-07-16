import type { Tone } from "./conversation";
import { getOpenAIClient, isMockMode } from "./openai";
import { defaultTtsVoice, isTtsVoice, type TtsVoice } from "./voices";

export type SpeakInput = { text: string; tone: Tone; delivery?: "needs"; voice?: TtsVoice };

const toneInstructions: Record<Tone, string> = {
  warm: "Speak warmly and affectionately, with an easy, friendly pace.",
  firm: "Speak clearly, confidently, and calmly, with a direct pace.",
  funny: "Speak warmly with light, playful humor and a subtle smile in the delivery.",
};

export async function speak({ text, tone, delivery, voice: selectedVoice }: SpeakInput): Promise<Response | null> {
  if (isMockMode()) return null;
  const model = process.env.TTS_MODEL || "gpt-4o-mini-tts";
  const configuredVoice = process.env.TTS_VOICE;
  const voice = selectedVoice ?? (isTtsVoice(configuredVoice) ? configuredVoice : defaultTtsVoice);
  return getOpenAIClient().audio.speech.create({
    model,
    voice,
    input: text,
    response_format: "mp3",
    ...(model.startsWith("tts-1") ? {} : { instructions: delivery === "needs" ? "Speak clearly, firmly, and calmly. Prioritize easy understanding and a measured pace." : toneInstructions[tone] }),
  });
}
