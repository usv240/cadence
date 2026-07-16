import { cannedTranscripts } from "./fixtures";
import { predict } from "../lib/predict";
import { neutralStyleCard } from "../lib/style-card";
import { calculateSessionImpact } from "../lib/impact";
import { offlineInitiate, offlinePredict } from "../lib/offline-fallback";

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

  const fallbackReplies = cannedTranscripts.map(({ transcript }) => offlinePredict({ transcript, count: 4 }));
  const fallbackOpeners = cannedTranscripts.map(({ transcript }) => offlineInitiate({ transcript, count: 4 }));
  const fallbackCounts = [...fallbackReplies, ...fallbackOpeners].map((candidates) => candidates.length);
  const hasDistinctFallbackReplies = fallbackReplies.every((candidates) => new Set(candidates.map((candidate) => candidate.text.toLocaleLowerCase())).size === candidates.length);
  const hasExpectedCounts = fallbackCounts.every((count) => count >= 2 && count <= 4);
  if (!hasDistinctFallbackReplies || !hasExpectedCounts) throw new Error("Offline fallback evaluation failed.");
  console.log(`Offline fallback: ${fallbackReplies.length} reply sets + ${fallbackOpeners.length} opener sets; ${hasDistinctFallbackReplies ? "no duplicate reply cards" : "duplicate reply check failed"}; ${hasExpectedCounts ? "valid candidate counts" : "count check failed"}.`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
