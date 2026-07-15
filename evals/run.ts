import { cannedTranscripts } from "./fixtures";
import { predict } from "../lib/predict";
import { neutralStyleCard } from "../lib/style-card";
import { calculateSessionImpact } from "../lib/impact";

const speakFasterPublishedMotorActionSavingsPercent = 57;

async function main() {
  const results = await Promise.all(cannedTranscripts.map(async ({ name, transcript }) => ({ name, output: await predict({ transcript, styleCard: neutralStyleCard }) })));
  const candidateTexts = results.flatMap((result) => result.output.candidates.map((candidate) => candidate.text));
  const totalCandidates = candidateTexts.length;
  const uniqueIntents = new Set(results.flatMap((result) => result.output.candidates.map((candidate) => candidate.intent))).size;
  const impact = calculateSessionImpact(candidateTexts);
  const comparison = impact.keystrokeSavingsPercent - speakFasterPublishedMotorActionSavingsPercent;
  console.log("Cadence eval (single pass)");
  console.log(`Transcripts: ${results.length}`);
  console.log(`Average candidates: ${(totalCandidates / results.length).toFixed(1)}`);
  console.log(`Intent diversity: ${uniqueIntents}/6`);
  console.log(`Selection taps: ${impact.tapsUsed} vs ${impact.typedKeystrokes} typed keystrokes`);
  console.log(`Keystroke savings: ${impact.keystrokeSavingsPercent.toFixed(1)}%`);
  console.log(`SpeakFaster comparison: ${comparison >= 0 ? "+" : ""}${comparison.toFixed(1)} percentage points vs its published 57% motor-action savings.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
