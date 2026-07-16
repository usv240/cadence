type RateRecord = { count: number; resetAt: number };

const rateLimit = new Map<string, RateRecord>();
const maxRequestsPerMinute = 20;
const maxTrackedClients = 10_000;
const maxApiBodyBytes = 32_768;

function realModeEnabled() {
  return process.env.MOCK_MODE === "0";
}

export function rejectMissingModelConsent(request: Request): Response | null {
  if (!realModeEnabled() || request.headers.get("x-cadence-model-consent") === "1") return null;
  return Response.json({ error: "Review and accept Cadence's real-mode data notice before using online AI features." }, { status: 428, headers: { "Cache-Control": "no-store" } });
}

function clientAddress(request: Request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function isDevelopment() {
  return process.env.NODE_ENV !== "production";
}

export function rejectUntrustedRequest(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return isDevelopment() ? null : Response.json({ error: "A same-origin browser request is required." }, { status: 403 });
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  if (!host) return Response.json({ error: "Unable to verify request origin." }, { status: 403 });
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const expectedProtocol = forwardedProtocol || (isDevelopment() ? originUrl.protocol.replace(":", "") : "https");
    if (originUrl.protocol !== `${expectedProtocol}:`) return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    return null;
  } catch {
    return Response.json({ error: "Unable to verify request origin." }, { status: 403 });
  }
}

export function rejectRateLimited(request: Request, bucket: string): Response | null {
  const now = Date.now();
  if (rateLimit.size > maxTrackedClients) {
    rateLimit.forEach((record, key) => { if (record.resetAt <= now) rateLimit.delete(key); });
  }
  const key = `${bucket}:${clientAddress(request)}`;
  const record = rateLimit.get(key);
  if (!record || record.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (record.count >= maxRequestsPerMinute) return Response.json({ error: "Too many requests. Please try again in a minute." }, { status: 429, headers: { "Retry-After": String(Math.ceil((record.resetAt - now) / 1000)), "Cache-Control": "no-store" } });
  record.count += 1;
  return null;
}

export async function readJsonBody<T>(request: Request): Promise<{ data: T } | { error: Response }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return { error: Response.json({ error: "Content-Type must be application/json." }, { status: 415 }) };
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxApiBodyBytes) return { error: Response.json({ error: "Request body is too large." }, { status: 413 }) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxApiBodyBytes) return { error: Response.json({ error: "Request body is too large." }, { status: 413 }) };
  try {
    const data = JSON.parse(raw) as T;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: Response.json({ error: "Request body must be a JSON object." }, { status: 400 }) };
    return { data };
  } catch {
    return { error: Response.json({ error: "Request body must be valid JSON." }, { status: 400 }) };
  }
}

export function serverError(message: string): Response {
  return Response.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function validateTranscript(transcript: unknown): string | null {
  if (!Array.isArray(transcript) || !transcript.length) return "transcript is required.";
  if (transcript.length > 20) return "transcript must contain 20 turns or fewer.";
  let totalCharacters = 0;
  for (const turn of transcript) {
    if (!turn || typeof turn !== "object") return "each transcript turn must be an object.";
    const candidate = turn as Record<string, unknown>;
    if (typeof candidate.speaker !== "string" || !candidate.speaker.trim() || candidate.speaker.length > 80 || typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 800) return "each transcript turn must contain a short speaker and text.";
    totalCharacters += candidate.speaker.length + candidate.text.length;
  }
  return totalCharacters > 4000 ? "transcript must contain 4000 characters or fewer." : null;
}

export function validateString(value: unknown, limit: number, name: string, required = true): string | null {
  if (typeof value !== "string") return required ? `${name} is required.` : null;
  if (value.length > limit) return `${name} must contain ${limit} characters or fewer.`;
  if (required && !value.trim()) return `${name} cannot be empty.`;
  return null;
}

export const exceedsLength = validateString;
