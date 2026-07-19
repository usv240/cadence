import { NextResponse } from "next/server";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError, validateString, validateTranscript } from "@/lib/api-guard";
import { expand, type ExpandInput } from "@/lib/expand";
import { validatePersonalProfile } from "@/lib/profile";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = await rejectRateLimited(request, "expand");
    if (limited) return limited;
    const body = await readJsonBody<ExpandInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const transcriptError = validateTranscript(input.transcript);
    const keywordError = exceedsLength(input.keyword, 40, "keyword");
    const profileError = validatePersonalProfile(input.profile);
    const styleError = validateString(input.styleCard, 2_000, "styleCard");
    if (transcriptError || keywordError || profileError || styleError) return NextResponse.json({ error: transcriptError ?? keywordError ?? profileError ?? styleError }, { status: 400 });
    return NextResponse.json(await expand(input));
  } catch {
    return serverError("Unable to expand the keyword.");
  }
}
