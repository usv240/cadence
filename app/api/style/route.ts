import { exceedsLength, readJsonBody, rejectMissingModelConsent, rejectRateLimited, rejectUntrustedRequest, serverError } from "@/lib/api-guard";
import { buildStyleCard, type StyleInput } from "@/lib/style-card";

export async function POST(request: Request) {
  try {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;
    const consent = rejectMissingModelConsent(request);
    if (consent) return consent;
    const limited = rejectRateLimited(request, "style");
    if (limited) return limited;
    const body = await readJsonBody<StyleInput>(request);
    if ("error" in body) return body.error;
    const input = body.data;
    const samplesError = exceedsLength(input.samples, 8000, "samples");
    if (samplesError) return Response.json({ error: samplesError }, { status: 400 });
    if (!input.samples.trim()) return Response.json({ error: "samples cannot be empty." }, { status: 400 });
    return Response.json(await buildStyleCard(input));
  } catch {
    return serverError("Unable to learn your voice.");
  }
}
