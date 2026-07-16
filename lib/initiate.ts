import type { Candidate, Intent, TranscriptInput } from "./conversation";
import { getOpenAIClient, isMockMode, modelConfig } from "./openai";
import { intents, mockInitiate } from "./mock-language";
import type { PersonalProfile } from "./profile";
import type { ConversationMemory } from "./memory";
import type { ConversationSettings } from "./conversation-settings";

export type InitiateInput = { transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile; memory?: ConversationMemory; settings?: ConversationSettings; keyword?: string; n?: number };
export type InitiateOutput = { candidates: Candidate[] };

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

export async function initiate({ transcript, styleCard, profile, memory, settings, keyword, n = 4 }: InitiateInput): Promise<InitiateOutput> {
  const count = Math.min(Math.max(n, 1), 4);
  if (isMockMode()) return { candidates: mockInitiate({ transcript, profile, memory, keyword, count }) };
  const response = await getOpenAIClient().responses.create({
    ...modelConfig,
    input: [
      { role: "system", content: "Help <user> START a live conversation on their own terms. Propose N short openers in the user's learned voice, grounded in their saved profile, local memory, conversation mode, and any recent transcript. Profile names and facts belong only to <user>; never assign them to another person mentioned in the transcript. Respect stated people, topic, and phrasing boundaries. Do not merely react. Spread options across sharing news, asking about the other person, raising a concern, opening a story, and expressing affection. Use memory and profile facts only when natural and never invent them. If a keyword is provided, use it naturally. Every opener needs a distinct opening word and correct sentence case. Return only the schema." },
      { role: "user", content: JSON.stringify({ transcript, styleCard, profile, memory, settings, keyword, n: count }) },
    ],
    text: { format: { type: "json_schema", name: "cadence_initiators", strict: true, schema } },
  });
  const parsed = JSON.parse(response.output_text) as InitiateOutput;
  if (!Array.isArray(parsed.candidates) || !parsed.candidates.every((candidate) => typeof candidate.text === "string" && candidate.text.trim().length > 0 && candidate.text.length <= 600 && intents.includes(candidate.intent as Intent))) throw new Error("The initiation response did not match the expected schema.");
  return { candidates: parsed.candidates.slice(0, count) };
}
