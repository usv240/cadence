import { speak, type SpeakInput } from "@/lib/speak";
import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError } from "@/lib/api-guard";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = rejectRateLimited(request, "speak");
    if (limited) return limited;
    const body = await readJsonBody<SpeakInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const textError = exceedsLength(input.text, 600, "text");
    if (textError || !["warm", "firm", "funny"].includes(input.tone) || (input.delivery !== undefined && input.delivery !== "needs")) return Response.json({ error: textError ?? "a valid tone or delivery is required." }, { status: 400 });
    const audio = await speak(input);
    if (!audio) return new Response(null, { status: 204 });
    return new Response(audio.body, { headers: { "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return serverError("Unable to create speech.");
  }
}
