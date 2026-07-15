import { NextResponse } from "next/server";
import { exceedsLength, rejectRateLimited } from "@/lib/api-guard";
import { toneAdjust, type ToneAdjustInput } from "@/lib/toneAdjust";

export async function POST(request: Request) {
  try {
    const limited = rejectRateLimited(request);
    if (limited) return limited;
    const input = await request.json() as ToneAdjustInput;
    const textError = exceedsLength(input.text, 600, "text");
    if (textError || !["warm", "firm", "funny"].includes(input.tone)) return NextResponse.json({ error: textError ?? "a valid tone is required." }, { status: 400 });
    return NextResponse.json(await toneAdjust(input));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to adjust the tone." }, { status: 500 });
  }
}
