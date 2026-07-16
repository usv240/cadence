# Cadence

Cadence is a real-time communication companion for people with ALS. It listens to a conversation, prepares short replies in the user’s voice, and lets the user speak with one tap instead of composing a full message under time pressure.

**North star:** help a person stay present in a fast conversation—in their own words, in time to matter.

> Cadence is an assistive communication prototype, not a medical device or a replacement for an AAC assessment, speech-language pathologist (SLP), or emergency care plan.

## Why Cadence

Traditional AAC can be powerful, but live conversation still creates a timing problem: by the time someone types a response, the moment may have passed. Cadence stages grounded, diverse reply choices before the user acts; it also supports starting a conversation rather than only reacting.

**Novelty:** other tools help compose a message faster; Cadence prepares real-time conversational presence in the user’s own voice and supports initiating as well as responding.

## What It Does

### Live conversation

- Shows a compact rolling room transcript.
- Uses the browser’s Web Speech API for ambient captions—no transcription API key required.
- When a new confirmed partner turn arrives, pre-generates reply cards in the background with a 500 ms debounce and one in-flight request cap.
- Gives each reply a diverse conversational intent: agree, ask, react, joke, redirect, or reply.
- Provides **Start something** for four user-led conversation openers.
- Supports a keyword/idea steer and tone adjustment (`warm`, `firm`, `funny`).

### Trust and control

- A reply is never spoken automatically.
- Optional preview-before-speak lets the user edit a reply, make it shorter, ask for “more like me,” save it, reject it, or block it from future suggestions.
- The user can stop active audio playback.
- Low-confidence browser captions are held out of prediction until the user confirms or edits them with **Fix caption**.
- Conversation setup stores a mode, energy level, people present, and topic/phrasing boundaries locally; low energy requests fewer choices and slows scanning.

### Fast expression and fallbacks

- One-tap quick reactions, feelings, tone choices, custom speech, **My needs**, and **Hold the floor**.
- Editable needs and feelings are stored locally.
- An always-available **Offline backup board** combines saved needs, feelings, and favorite replies without depending on listening or prediction.
- The backup board downloads a plain-text communication plan for family or care teams.
- Last generated reply cards are retained locally for recovery when replies are temporarily unavailable.

### Personalization and continuity

- **Your voice:** paste sample messages to generate, review, and edit a compact style card.
- **Personal details:** preferred name, full name, pronouns, and optional context for relevant grounding.
- **Local memory:** small rolling lists of people and topics; the user can inspect and clear them.
- **Saved replies:** users can favorite useful replies and block unwanted suggestions.

### Access and learning

- Large touch targets, high contrast, visible focus states, keyboard navigation, and screen-reader labels/live announcements.
- Light and dark themes follow the system setting on first visit; the user's choice persists locally.
- Single-switch scanning with Space/Enter or a large Select button; scan speed is configurable.
- The backup board is included in scanning mode.
- Optional four-step tutorial from the welcome screen or **More → About → Take the tour**.
- Contextual `i` help explains secondary response controls on hover, focus, and tap.

## Quick Start

Requirements: Node.js 20+ and npm.

```powershell
npm install
$env:MOCK_MODE="1"
npm run dev
```

Open `http://localhost:3000`.

- `/` is the landing page.
- `/app` is the live communication companion.

### Judge Quick Start

Use mock mode to review the complete experience without an API key, microphone, or network connection:

1. Open `/app` and choose **Reset demo**.
2. Tap a prepared reply to see it enter the Spoken panel.
3. Choose **Start something** to show user-led openers.
4. Open **My needs** or the backup-board icon for essential communication.
5. Turn off the network to verify local reply cards, saved phrases, and device speech fallback.

The reset is deterministic and does not alter the user's saved voice, personal details, or preferences.

### Mock mode

`MOCK_MODE=1` is the default safe development mode. Prediction, initiation, expansion, style learning, tone changes, and speech run through local mocks—no API key and no model/audio cost.

Browser live captions still use the browser’s Web Speech API when the user turns **Listen** on. Browser support varies; Chrome and Edge are recommended.

### Real mode

Create an ignored `.env.local` file:

```bash
MOCK_MODE=0
OPENAI_API_KEY=your_openai_key
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=marin
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `MOCK_MODE` | No | Set `1` for local mocks; set `0` for real OpenAI generation and TTS. |
| `OPENAI_API_KEY` | Real mode | Server-only key for OpenAI Responses and Audio Speech. |
| `TTS_MODEL` | No | OpenAI text-to-speech model; defaults to `gpt-4o-mini-tts`. |
| `TTS_VOICE` | No | Default OpenAI voice; defaults to `marin`. A user can choose a built-in voice locally in **More → Speaking voice** without changing this variable. |

Never expose an API key through `NEXT_PUBLIC_*`, client code, screenshots, or commits.

### Vercel Production Setup

1. Import the repository, keep `MOCK_MODE=1` for preview deployments, and set `MOCK_MODE=0` only for Production.
2. Add `OPENAI_API_KEY` and optional TTS variables only to the Production environment; redeploy after changing variables.
3. Enable Vercel WAF and a durable distributed rate limiter before exposing paid routes publicly. The repository's in-memory limiter is only a local safety layer.
4. Monitor `/api/health` for deployment availability. It returns only `{ status, mode }` and never conversation content.
5. Enable platform error/latency alerts with transcript, profile, and speech-content collection disabled.

## First Use

1. Choose **Start** in the welcome dialog to reach prepared reply cards immediately, or choose **Show me how** for the short guided tour.
2. Turn **Listen** on when browser captions are useful. Grant microphone permission only when prompted.
3. Tap a reply card to preview/speak it, or use **Start something** to initiate a topic.
4. Open **More** to optionally set up a learned voice, personal details, local memory, scanning, demo playback, debug recording, or the tutorial.
5. Open **More ways to respond** when needed for quick reactions, feelings, tone, generated wording, or exact custom speech.
6. Use **My needs**, **Hold the floor**, or the backup-board icon for fast fallback communication.

## Privacy and Local Data

Cadence has no account and no application database. The following values are stored in this browser’s `localStorage` so the interface can recover and personalize locally:

| Local key | Contents |
| --- | --- |
| `cadence.lastSuggestions` | Most recent generated reply cards for local recovery. |
| `cadence.styleCard` | Learned or edited voice style card. |
| `cadence.profile` | Optional personal details, saved locally as they are entered. |
| `cadence.memory` | Extracted people and topics—not a full transcript. |
| `cadence.needs` / `cadence.feelings` | Editable quick phrases. |
| `cadence.replyPreferences` | Preview setting, favorites, and blocked suggestions. |
| `cadence.conversationSettings` | Mode, energy, boundaries, and scan speed. |
| `cadence.theme` | Chosen light or dark display theme. |
| `cadence.tone` | Chosen warm, firm, or funny delivery preference. |
| Onboarding flags | First-run and first-success state. |
| `cadence.debugLog` | Sensitive diagnostic events **only when the user explicitly enables debug recording**. |

Cadence does **not** persist the full transcript, Spoken panel, or microphone audio by default.

Use the in-app **Privacy** control to review real-mode data handling, grant real-mode consent, or erase every `cadence.*` value stored on the device. Real OpenAI routes reject requests until that consent is present; mock mode and offline essentials do not require it.

In mock mode, model and speech content stays on-device. In real mode, Cadence sends only context required for the user-requested OpenAI prediction, initiation, rewrite, style-learning, or speech request. Responses API requests set `store: false`. The browser’s Web Speech implementation is controlled by the browser/vendor; review that browser’s privacy controls before enabling Listen.

Local storage is not encrypted by Cadence. Use a locked device, avoid shared browser profiles, and clear local memory/debug logs after sensitive testing.

## Offline Behavior

In production, Cadence registers a small service worker after the first successful visit. It caches only the static app shell and framework assets for offline startup.

- API responses, transcripts, and audio are **never** cached by the service worker.
- The local backup board, needs, feelings, favorites, settings, and last reply cards remain available from browser storage.
- When offline, Cadence generates simple local reply cards and openers, keeps quick phrases and custom speech available, and uses the device's built-in speech synthesis when supported.
- Live model generation and browser captions require their respective network/browser services.

For a real communication plan, keep the downloaded plan and other low-tech backups available independently of the web app.

## Architecture

```text
Browser SpeechRecognition ──> rolling transcript ──> local context manager
                                                   └─> speculative prediction

local profile + voice + memory + settings ──> Next.js API routes ──> OpenAI Responses

reply / quick phrase / backup board ──> OpenAI Speech (or mock) ──> playback
```

- **Client:** Next.js App Router, React, TypeScript strict mode, Tailwind CSS.
- **Model routes:** `app/api/predict`, `initiate`, `expand`, `tone`, `style`, and `speak`.
- **Model interfaces:** `lib/predict.ts`, `expand.ts`, `toneAdjust.ts`, `style-card.ts`, `initiate.ts`, `speak.ts`, and `browser-transcribe.ts`.
- **Mock/real boundary:** `lib/conversation-service.ts` and `MOCK_MODE`.
- **Local resilience:** browser storage, static shell service worker, backup board, and last suggestions.

## Built With Codex and GPT-5.6

Cadence uses GPT-5.6 Luna through the OpenAI Responses API with low reasoning effort for latency-sensitive, structured reply prediction, initiation, keyword expansion, tone rewriting, and style-card creation. OpenAI Audio Speech provides real-mode spoken output.

Codex accelerated the implementation of the App Router interface, typed service boundaries, structured model routes, accessibility controls, mock/real fallbacks, local-first persistence, rate-limit hardening, offline recovery, and the evaluation harness. Product decisions remained focused on the ALS communication problem: replies must arrive before the moment passes, remain in the user's voice, and never depend on a single networked service.

## Submission Demo

For a short demo video, show one complete story: reset the dinner demo; tap a prepared reply; add personal details or a style card; use **Start something**; open **My needs**; then disconnect and show that local reply cards and phrases remain usable. Explain that GPT-5.6 produces structured, grounded choices in real mode while `MOCK_MODE=1` makes the same flow safe for judges to run locally.

## Security and Cost Controls

- `.env.local` is Git-ignored; secrets are server-only.
- All paid API routes require same-origin JSON requests, bound bodies and field sizes, validate nested data, and return generic failures rather than provider errors.
- API endpoints use lightweight endpoint-scoped, per-IP in-memory rate limiting (20 requests/minute per endpoint/IP).
- Production responses set a Content Security Policy, anti-framing headers, strict referrer policy, MIME-sniffing protection, restrictive browser permissions, and no-index metadata.
- The live app and API routes send `Cache-Control: no-store`; the service worker intentionally caches only static shell/framework resources.
- Debug recording is opt-in, bounded, local-only, viewable, exportable, and clearable from **More**.

### Deployment requirement

The in-memory limiter is not sufficient for a public paid-key deployment because it is per server instance. Before public launch, enable Vercel Firewall/WAF (or equivalent) and a durable distributed/edge rate limiter.

## Accessibility and Access Methods

- All critical controls are designed as large, labeled buttons with keyboard focus styling.
- Reply cards, quick phrases, needs, feelings, backup board, and floor-holding actions can be selected by touch or keyboard.
- Scanning uses Space/Enter and supports Bluetooth switches that emit those keys.
- Scan speed is configurable in **More ways to respond → Set up**.
- Tooltips work with hover, keyboard focus, and touch.
- No operation requires a gesture more complex than a tap/click or keyboard activation.

Real switch, eye-gaze, head-pointer, landscape-tablet, and screen-reader testing should be completed with actual users and assistive technology before clinical or public deployment.

## Impact and Evaluation

Cadence computes each session’s estimated typing-time savings from actual spoken message length using a stated 15 words/minute AAC typing baseline. `npm run eval` runs three canned fixtures once and reports candidate count, intent diversity, tap/keystroke savings, and the comparison baseline used for Google SpeakFaster’s published 57% keystroke savings.

The more meaningful outcome measures are participation: replies spoken, conversations initiated, time to response, edit/reject rate, and whether suggestions sound like the user. Those measures should be evaluated in a supervised pilot with people who use AAC, their communication partners, and SLPs.

Communication loss is common in ALS; research estimates that many people eventually lose functional speech, while AAC adoption also depends on fit, training, support, and fatigue. [Acoustic voice analysis study](https://pubmed.ncbi.nlm.nih.gov/37760880/), [AAC fit study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6924798/), [AAC abandonment study](https://pubmed.ncbi.nlm.nih.gov/17114167/), [ALS eye-gaze study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11530652/).

| AAC barrier | Cadence response |
| --- | --- |
| Learning curve | Ready-to-tap replies, a short tour, and contextual help. |
| Effort and eye-tracking fatigue | Minimal taps, single-switch scanning, adjustable scan speed, and backup phrases. |
| Partner-training burden | Conversation partners can speak normally while Cadence prepares options. |
| Connection and agency | Personal voice, quick feelings, user-led openers, and “Hold the floor.” |
| Technology failure | Local needs/feelings/favorites, last replies, backup board, and downloadable plan. |

## Development Commands

```powershell
npm run dev
npm run typecheck
npm run lint
npm run build
npm run eval
npm run test:e2e
```

`npm run test:e2e` starts Cadence in `MOCK_MODE=1` and verifies onboarding, speaking a staged reply, local profile persistence, needs phrases, and offline fallback behavior in Chromium.

Run the full verification suite before handing off changes:

```powershell
npm run typecheck
npm run lint
npm run build
```

## Current Limitations and Next Validation

- Browser live-caption accuracy and confidence signals vary by platform.
- In-memory rate limiting must be replaced with a durable store for multi-instance production deployment.
- The service worker supports app-shell recovery, not offline AI, browser captions, or network TTS.
- Cadence has not yet completed a formal usability study with people with ALS, AAC users, caregivers, or SLPs.
- Treat the downloaded communication plan as a convenience document; maintain clinician-recommended low-tech backup methods as well.
