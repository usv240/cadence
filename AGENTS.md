# AGENTS.md — Cadence

> Drop this file into the repo root. Codex auto-reads it for project context. Keep it lean and current.

## What this is
Cadence is a real-time conversational communication aid for people with ALS. It listens to a live conversation, predicts what the *user* would want to say (in their own voice and style), and stages responses so speaking is **one tap instead of a minute of typing**.
**North star:** a person with ALS joins a fast dinner conversation in their own voice, *in time to matter*.
Full context: `Cadence-Master-Plan.md`, `Competitive-Analysis.md` (planning folder).

## Architecture (pipeline)
- **Ambient STT** (GPT-Realtime / Whisper) → rolling room transcript
- **Context manager** (recent turns + user style card + people memory)
- **Prediction engine** (GPT-5.6, structured JSON): 3–4 diverse, ranked candidate replies; speculative pre-compute *during the partner's turn*
- **UI**: tappable suggestion cards + tone chips + keyword-steer input + backchannel chips + speak button
- **TTS voice clone** (ElevenLabs) → audio out

## Stack
- Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- OpenAI SDK (Responses API, `gpt-5.6`, structured output) for prediction
- GPT-Realtime for STT · ElevenLabs for cloned TTS
- Deploy: Vercel

## Conventions
- Small, single-purpose modules. Server logic in `app/api` route handlers.
- All model-facing logic behind clean interfaces (`predict`, `expand`, `toneAdjust`, `speak`, `transcribe`) so mocks swap to real APIs cleanly.
- Prompts to the model stay lean; candidates returned as structured JSON.
- **Accessibility-first UI:** large tap targets, high contrast, keyboard + screen-reader friendly.
- No secrets in code — env vars: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

## Autonomy policy
- For build/fix requests: make in-scope local changes and run non-destructive validation (typecheck, lint, tests, dev build) **without asking first**.
- Ask before: installing heavy deps beyond the stack above, external/destructive actions, or expanding scope.

## How to validate
- `npm run typecheck && npm run lint && npm run build` must pass.
- The core screen must render and be fully clickable with **mocked** data before any real API is wired.
- Keep the app runnable at every step.

## Current focus
See `Codex-Build-Brief.md` for the phased task plan. Build incrementally.
