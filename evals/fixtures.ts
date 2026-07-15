import type { TranscriptInput } from "../lib/conversation";

export const cannedTranscripts: { name: string; transcript: TranscriptInput[] }[] = [
  { name: "picnic plans", transcript: [{ speaker: "Maya", text: "A picnic could be fun, but someone has to remember the blanket." }, { speaker: "Jon", text: "I can handle snacks. Everything else is still under review." }] },
  { name: "concert memories", transcript: [{ speaker: "Lena", text: "That band played for almost three hours last night." }, { speaker: "Maya", text: "Their encore was worth the late train home." }] },
  { name: "family update", transcript: [{ speaker: "Jon", text: "My sister finally moved into her new place today." }, { speaker: "Lena", text: "She sounds relieved to be done with all those boxes." }] },
];
