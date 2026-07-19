import { NextResponse } from "next/server";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError, validateString, validateTranscript } from "@/lib/api-guard";
import { initiate, type InitiateInput } from "@/lib/initiate";
import { validatePersonalProfile } from "@/lib/profile";
import { validateConversationMemory } from "@/lib/memory";
import { validateConversationSettings } from "@/lib/conversation-settings";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = await rejectRateLimited(request, "initiate");
    if (limited) return limited;
    const body = await readJsonBody<InitiateInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const transcriptError = Array.isArray(input.transcript) && input.transcript.length === 0 ? null : validateTranscript(input.transcript);
    const keywordError = input.keyword === undefined ? null : exceedsLength(input.keyword, 40, "keyword");
    const profileError = validatePersonalProfile(input.profile);
    const memoryError = validateConversationMemory(input.memory);
    const settingsError = validateConversationSettings(input.settings);
    const styleError = validateString(input.styleCard, 2_000, "styleCard");
    if (transcriptError || keywordError || profileError || memoryError || settingsError || styleError) return NextResponse.json({ error: transcriptError ?? keywordError ?? profileError ?? memoryError ?? settingsError ?? styleError }, { status: 400 });
    return NextResponse.json(await initiate(input));
  } catch {
    return serverError("Unable to start a conversation.");
  }
}
