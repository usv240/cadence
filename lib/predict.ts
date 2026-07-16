import type { Candidate, Intent, TranscriptInput } from "./conversation";
import { getOpenAIClient, isMockMode, modelConfig } from "./openai";
import { intents, mockPredict } from "./mock-language";
import type { PersonalProfile } from "./profile";
import type { ConversationMemory } from "./memory";
import type { ConversationSettings } from "./conversation-settings";

export type PredictInput = { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; feedback?: "more_like_me"; keyword?: string; n?: number };
export type PredictOutput = { candidates: Candidate[] };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "intent"],
        properties: {
          text: { type: "string" },
          intent: { type: "string", enum: intents },
        },
      },
    },
  },
};

export async function predict({ transcript, styleCard, profile, memory, settings, feedback, keyword, n = 4 }: PredictInput): Promise<PredictOutput> {
  const count = Math.min(Math.max(n, 1), 4);
  if (isMockMode()) return { candidates: mockPredict({ transcript, profile, memory, keyword, count }) };
  const response = await getOpenAIClient().responses.create({
    ...modelConfig,
    input: [
      { role: "system", content: "Help <user> join a LIVE conversation. Propose N short, diverse replies to the newest transcript turn. Answer direct questions directly and use its actual subject, people, and wording; do not revive older topics. Follow the style card. Respect conversation mode, energy, people present, and stated topic/phrase boundaries. Memory is local context: use it only when natural. Use profile details only when relevant and never invent facts. If feedback says more_like_me, follow the style card more closely without copying it verbatim. If a keyword is given, use it while staying responsive to the newest turn. Every candidate needs a distinct opening word and correct sentence case. Return only the schema." },
      { role: "user", content: JSON.stringify({ transcript, styleCard, profile, memory, settings, feedback, keyword, n: count }) },
    ],
    text: { format: { type: "json_schema", name: "cadence_candidates", strict: true, schema } },
  });
  const parsed = JSON.parse(response.output_text) as PredictOutput;
  if (!Array.isArray(parsed.candidates) || !parsed.candidates.every((candidate) => typeof candidate.text === "string" && candidate.text.trim().length > 0 && candidate.text.length <= 600 && intents.includes(candidate.intent as Intent))) throw new Error("The prediction response did not match the expected schema.");
  return { candidates: parsed.candidates.slice(0, count) };
}
