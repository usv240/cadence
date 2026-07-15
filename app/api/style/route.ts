import { exceedsLength, rejectRateLimited } from "@/lib/api-guard";
import { buildStyleCard, type StyleInput } from "@/lib/style-card";

export async function POST(request: Request) {
  try {
    const limited = rejectRateLimited(request);
    if (limited) return limited;
    const input = await request.json() as StyleInput;
    const samplesError = exceedsLength(input.samples, 8000, "samples");
    if (samplesError) return Response.json({ error: samplesError }, { status: 400 });
    if (!input.samples.trim()) return Response.json({ error: "samples cannot be empty." }, { status: 400 });
    return Response.json(await buildStyleCard(input));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to learn your voice." }, { status: 500 });
  }
}
