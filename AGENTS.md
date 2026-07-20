# AGENTS.md — Cadence

## What this is
Cadence is a real-time conversational communication aid for people with ALS. It listens to a live conversation, predicts what the user may want to say in their own voice and style, and stages replies so speaking can take one tap instead of a minute of typing.

**North star:** a person with ALS joins a fast dinner conversation in their own words, in time to matter.

## Architecture
- **Ambient captions:** browser Web Speech API feeds a rolling room transcript.
- **Context:** recent turns, learned style card, local profile, and local people/topic memory.
- **Prediction:** OpenAI Responses API with `gpt-5.6-luna`, low reasoning, and structured JSON returns 3–4 diverse candidates; interim captions pre-warm a request and final captions replace it.
- **Speech:** streamed OpenAI Audio Speech in real mode, with immediate browser device speech as the offline and low-latency fallback.
- **Resilience:** `MOCK_MODE`, local session recovery, saved replies, editable needs/feelings, and an offline backup board.

## Stack
- Next.js App Router, TypeScript strict mode, Tailwind CSS.
- OpenAI SDK for structured generation and real-mode TTS.
- Browser Web Speech API for captions; Upstash Redis for durable real-mode rate limiting.
- Vercel deployment with an account-level WAF rule for `/api/*`.

## Conventions
- Keep modules small and single-purpose; server logic belongs in `app/api` route handlers.
- Keep model-facing logic behind `predict`, `expand`, `toneAdjust`, `speak`, `transcribe`, and related interfaces so mocks and real services swap cleanly.
- Keep prompts lean and return structured data.
- Prioritize large targets, high contrast, keyboard/switch access, and screen-reader support.
- Never put secrets in code. Real mode needs `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` server-side only.

## Validation
Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run eval`, and `npm run test:e2e` for changes that affect those areas. Keep mock mode runnable without keys or API cost.

## Scope
Make focused local changes and run non-destructive validation. Ask before external, destructive, costly, or materially scope-expanding actions.
