import OpenAI from "openai";

export const isMockMode = () => process.env.MOCK_MODE !== "0";

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required when MOCK_MODE=0.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // Cadence shows an explicit retry action. Retrying a paid generation after
    // an uncertain network failure can duplicate both cost and a user's reply.
    maxRetries: 0,
    timeout: 25_000,
  });
}

export const modelConfig = {
  model: "gpt-5.6-luna",
  reasoning: { effort: "low" as const },
  store: false,
};
