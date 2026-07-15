import { getOpenAIClient, isMockMode, modelConfig } from "./openai";

export const neutralStyleCard = "Neutral default: clear, conversational, and respectful. This is not a learned personal voice.";

export type StyleInput = { samples: string };
export type StyleOutput = { styleCard: string };

const schema = { type: "object", additionalProperties: false, required: ["styleCard"], properties: { styleCard: { type: "string" } } };

export async function buildStyleCard({ samples }: StyleInput): Promise<StyleOutput> {
  if (isMockMode()) return { styleCard: mockStyleCard(samples) };
  const response = await getOpenAIClient().responses.create({
    ...modelConfig,
    input: [
      { role: "system", content: "Distill the user's pasted messages into a compact style card for conversational reply generation. Capture tone, recurring phrases, vocabulary, humor, values, and sentence length. Describe only evidence from the samples; do not invent a persona. Return only the schema." },
      { role: "user", content: samples },
    ],
    text: { format: { type: "json_schema", name: "cadence_style_card", strict: true, schema } },
  });
  const parsed = JSON.parse(response.output_text) as StyleOutput;
  if (typeof parsed.styleCard !== "string" || !parsed.styleCard.trim()) throw new Error("The style response did not match the expected schema.");
  return { styleCard: parsed.styleCard.trim() };
}

function mockStyleCard(samples: string): string {
  const messages = samples.split(/\n+/).map((message) => message.trim()).filter(Boolean);
  const words = messages.flatMap((message) => message.toLowerCase().match(/[a-z']+/g) ?? []);
  const vocabulary = Array.from(new Set(words.filter((word) => word.length > 3))).slice(0, 6).join(", ") || "everyday language";
  const averageLength = words.length / Math.max(messages.length, 1);
  const punctuation = samples.includes("!") ? "uses emphatic punctuation" : "uses measured punctuation";
  return `Learned from ${messages.length} message samples: ${averageLength <= 12 ? "short, direct sentences" : "full, conversational sentences"}; ${punctuation}; recurring vocabulary includes ${vocabulary}.`;
}
