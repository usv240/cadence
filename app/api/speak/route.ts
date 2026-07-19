import { speak, type SpeakInput } from "@/lib/speak";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError } from "@/lib/api-guard";
import { isTtsVoice } from "@/lib/voices";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = await rejectRateLimited(request, "speak");
    if (limited) return limited;
    const body = await readJsonBody<SpeakInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const textError = exceedsLength(input.text, 600, "text");
    if (textError || !["warm", "firm", "funny"].includes(input.tone) || (input.delivery !== undefined && input.delivery !== "needs") || (input.voice !== undefined && !isTtsVoice(input.voice))) return Response.json({ error: textError ?? "a valid tone, delivery, or voice is required." }, { status: 400 });
    const audio = await speak(input);
    if (!audio) return new Response(null, { status: 204 });
    return new Response(audio.body, { headers: { "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return serverError("Unable to create speech.");
  }
}
