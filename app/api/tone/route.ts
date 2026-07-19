import { NextResponse } from "next/server";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError } from "@/lib/api-guard";
import { toneAdjust, type ToneAdjustInput } from "@/lib/toneAdjust";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = await rejectRateLimited(request, "tone");
    if (limited) return limited;
    const body = await readJsonBody<ToneAdjustInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const textError = exceedsLength(input.text, 600, "text");
    if (textError || !["warm", "firm", "funny"].includes(input.tone)) return NextResponse.json({ error: textError ?? "a valid tone is required." }, { status: 400 });
    return NextResponse.json(await toneAdjust(input));
  } catch {
    return serverError("Unable to adjust the tone.");
  }
}
