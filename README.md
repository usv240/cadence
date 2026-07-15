# Cadence

Cadence is a real-time conversation copilot designed to help people with ALS participate quickly in live conversations.

Cadence uses GPT-5.6 Luna through the OpenAI Responses API to generate grounded, structured reply candidates. Codex was used to build the App Router experience, accessibility-first controls, mock/real service boundary, evaluations, and deployment-ready validation workflow.

## Run locally

```powershell
npm install
$env:MOCK_MODE="1"
npm run dev
```

`MOCK_MODE=1` is the offline default: predictions, captions, and speech use local mocks, so no API calls or audio generation occur.

## Environment variables

Create `.env.local` for real integrations:

```bash
MOCK_MODE=0
OPENAI_API_KEY=your_openai_key
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=marin
```

- `MOCK_MODE`: Set to `1` for safe offline mocks; set to `0` to enable real OpenAI predictions and speech.
- `OPENAI_API_KEY`: Required only when `MOCK_MODE=0` for reply prediction, expansion, tone adjustment, and spoken output.
- `TTS_MODEL`: Optional OpenAI Audio Speech model. Defaults to `gpt-4o-mini-tts`, which supports delivery instructions.
- `TTS_VOICE`: Optional OpenAI voice. Defaults to the warm `marin` voice.

Browser live captions use the built-in Web Speech API, so they do not require a key or OpenAI audio API. Press **Listen**, grant microphone access, and recognized speech will replace the mock caption generator while listening is active. Speech recognition support varies by browser; Chrome and Edge are recommended.

## Validate

```powershell
npm run typecheck
npm run lint
npm run build
npm run eval
```

## Build Week submission checklist

- Select the **Apps for Your Life** category and add a project description.
- Record a public YouTube demo under three minutes with audio explaining Cadence, Codex, and GPT-5.6.
- Provide the repository URL and ensure judges can run the mocked mode without credentials.
- Add the `/feedback` Codex session ID from the core build session to the Devpost submission.
