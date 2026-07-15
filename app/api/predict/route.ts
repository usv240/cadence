import { NextResponse } from "next/server";
import { exceedsLength, rejectRateLimited, validateTranscript } from "@/lib/api-guard";
import { predict, type PredictInput } from "@/lib/predict";
import { validatePersonalProfile } from "@/lib/profile";

export async function POST(request: Request) {
  try {
    const limited = rejectRateLimited(request);
    if (limited) return limited;
    const input = await request.json() as PredictInput;
    const transcriptError = validateTranscript(input.transcript);
    const keywordError = input.keyword === undefined ? null : exceedsLength(input.keyword, 40, "keyword");
    const profileError = validatePersonalProfile(input.profile);
    if (transcriptError || keywordError || profileError || typeof input.styleCard !== "string") return NextResponse.json({ error: transcriptError ?? keywordError ?? profileError ?? "styleCard is required." }, { status: 400 });
    return NextResponse.json(await predict(input));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to predict replies." }, { status: 500 });
  }
}
