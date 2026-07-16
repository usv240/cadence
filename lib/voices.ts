export const openAiTtsVoices = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"] as const;

export type TtsVoice = typeof openAiTtsVoices[number];

export const defaultTtsVoice: TtsVoice = "marin";

export const ttsVoiceOptions: { id: TtsVoice; name: string; recommended?: boolean }[] = [
  { id: "marin", name: "Marin", recommended: true },
  { id: "cedar", name: "Cedar", recommended: true },
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "fable", name: "Fable" },
  { id: "onyx", name: "Onyx" },
  { id: "nova", name: "Nova" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
];

export function isTtsVoice(value: unknown): value is TtsVoice {
  return typeof value === "string" && (openAiTtsVoices as readonly string[]).includes(value);
}
