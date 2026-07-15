import { speak, type SpeakInput } from "@/lib/speak";
import { exceedsLength, rejectRateLimited } from "@/lib/api-guard";

export async function POST(request: Request) {
  try {
    const limited = rejectRateLimited(request);
    if (limited) return limited;
    const input = await request.json() as SpeakInput;
    const textError = exceedsLength(input.text, 600, "text");
    if (textError || !["warm", "firm", "funny"].includes(input.tone)) return Response.json({ error: textError ?? "a valid tone is required." }, { status: 400 });
    const audio = await speak(input);
    if (!audio) return new Response(null, { status: 204 });
    return new Response(audio.body, { headers: { "Content-Type": audio.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create speech." }, { status: 500 });
  }
}
