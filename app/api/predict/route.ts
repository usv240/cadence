import { NextResponse } from "next/server";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError, validateString, validateTranscript } from "@/lib/api-guard";
import { predict, type PredictInput } from "@/lib/predict";
import { validatePersonalProfile } from "@/lib/profile";
import { validateConversationMemory } from "@/lib/memory";
import { validateConversationSettings } from "@/lib/conversation-settings";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = await rejectRateLimited(request, "predict");
    if (limited) return limited;
    const body = await readJsonBody<PredictInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const transcriptError = validateTranscript(input.transcript);
    const keywordError = input.keyword === undefined ? null : exceedsLength(input.keyword, 40, "keyword");
    const profileError = validatePersonalProfile(input.profile);
    const memoryError = validateConversationMemory(input.memory);
    const settingsError = validateConversationSettings(input.settings);
    const styleError = validateString(input.styleCard, 2_000, "styleCard");
    if (transcriptError || keywordError || profileError || memoryError || settingsError || styleError || (input.feedback !== undefined && input.feedback !== "more_like_me")) return NextResponse.json({ error: transcriptError ?? keywordError ?? profileError ?? memoryError ?? settingsError ?? styleError ?? "invalid feedback." }, { status: 400 });
    return NextResponse.json(await predict(input));
  } catch {
    return serverError("Unable to predict replies.");
  }
}
