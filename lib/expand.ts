import type { TranscriptInput } from "./conversation";
import { getOpenAIClient, isMockMode, modelConfig } from "./openai";
import { mockExpand } from "./mock-language";
import type { PersonalProfile } from "./profile";

export type ExpandInput = { keyword: string; transcript: TranscriptInput[]; styleCard: string; profile?: PersonalProfile };
export type ExpandOutput = { variants: string[] };

const schema = { type: "object", additionalProperties: false, required: ["variants"], properties: { variants: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } } } };

export async function expand({ keyword, transcript, styleCard, profile }: ExpandInput): Promise<ExpandOutput> {
  if (isMockMode()) return { variants: mockExpand({ keyword, transcript, profile }) };
  const response = await getOpenAIClient().responses.create({
    ...modelConfig,
    input: [
      { role: "system", content: "Write 2 or 3 short, full-sentence ways <user> could bring a 1–2 word keyword into this live conversation. Follow the supplied style card without inventing traits. Each variant must start with a different opening word; never repeat sentence starters. Use correct sentence case and capitalization, including capital I. Keep every variant grounded in the most recent transcript topic while naturally incorporating the keyword. Return only the schema." },
      { role: "user", content: JSON.stringify({ keyword, transcript, styleCard, profile }) },
    ],
    text: { format: { type: "json_schema", name: "cadence_expansions", strict: true, schema } },
  });
  const parsed = JSON.parse(response.output_text) as ExpandOutput;
  if (!Array.isArray(parsed.variants) || parsed.variants.length < 2 || !parsed.variants.every((variant) => typeof variant === "string" && variant.trim().length > 0 && variant.length <= 600)) throw new Error("The expansion response did not match the expected schema.");
  return { variants: parsed.variants };
}
