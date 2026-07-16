import type { Tone } from "./conversation";
import { getOpenAIClient, isMockMode, modelConfig } from "./openai";
import { mockToneAdjust } from "./mock-language";

export type ToneAdjustInput = { text: string; tone: Tone };
export type ToneAdjustOutput = { text: string };

const schema = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } };

export async function toneAdjust({ text, tone }: ToneAdjustInput): Promise<ToneAdjustOutput> {
  if (isMockMode()) return { text: mockToneAdjust(text, tone) };
  const response = await getOpenAIClient().responses.create({
    ...modelConfig,
    input: [
      { role: "system", content: "Rewrite the reply in the requested tone. Preserve its meaning, keep it short, and return only the schema." },
      { role: "user", content: JSON.stringify({ text, tone }) },
    ],
    text: { format: { type: "json_schema", name: "cadence_tone", strict: true, schema } },
  });
  const parsed = JSON.parse(response.output_text) as ToneAdjustOutput;
  if (typeof parsed.text !== "string" || !parsed.text.trim() || parsed.text.length > 600) throw new Error("The tone response did not match the expected schema.");
  return parsed;
}
