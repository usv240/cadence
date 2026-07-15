type RateRecord = { count: number; resetAt: number };

const rateLimit = new Map<string, RateRecord>();
const maxRequestsPerMinute = 20;

export function rejectRateLimited(request: Request): Response | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const record = rateLimit.get(ip);
  if (!record || record.resetAt <= now) {
    rateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (record.count >= maxRequestsPerMinute) return Response.json({ error: "Too many requests. Please try again in a minute." }, { status: 429, headers: { "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)) } });
  record.count += 1;
  return null;
}

export function validateTranscript(transcript: unknown): string | null {
  if (!Array.isArray(transcript)) return "transcript is required.";
  if (transcript.length > 20) return "transcript must contain 20 turns or fewer.";
  const text = transcript.map((turn) => typeof turn === "object" && turn !== null && "text" in turn && typeof turn.text === "string" ? turn.text : "").join("");
  if (text.length > 4000) return "transcript must contain 4000 characters or fewer.";
  return null;
}

export function exceedsLength(value: unknown, limit: number, name: string): string | null {
  if (typeof value !== "string") return `${name} is required.`;
  return value.length > limit ? `${name} must contain ${limit} characters or fewer.` : null;
}
