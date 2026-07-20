# Cadence UX and Performance Research Notes

Last reviewed: July 20, 2026

This note records the public guidance that informs Cadence design decisions. It is not a clinical validation claim. The most important remaining validation is voluntary testing with AAC users, caregivers, and speech-language professionals.

## Design principles in the product

| Principle | Evidence or guidance | Cadence decision |
| --- | --- | --- |
| Keep the current task clear | [W3C cognitive accessibility guidance](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/) recommends limiting interruptions and unnecessary content. | The ready reply cards remain the primary surface. Less frequent controls live behind an expander or the More menu. |
| Make controls forgiving | [WCAG 2.2 target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) requires 24 by 24 CSS pixels at AA. | Essential controls aim for 44 CSS pixels or larger, with visible focus rings and high contrast. |
| Preserve user agency | Eye-gaze and switch work requires both performance and qualitative feedback, according to [Gibbons and Beneteau](https://pubs.asha.org/doi/10.1044/aac19.3.64). | Suggestions never speak automatically. Eye-gaze only moves focus. Space, Enter, touch, or Select highlighted confirms every utterance. |
| Treat gaze as context-sensitive | Eye-gaze AAC work identifies calibration, selection accuracy, and fatigue as real considerations. See [ALS Association AAC evaluation material](https://www.als.org/sites/default/files/2021-06/June-The-ALS-AAC-Evaluation%20%281%29.pdf). | Gaze is opt-in, calibrated locally, has a visible off switch, clears focus outside real targets, and uses a short dwell before a target can be selected. |
| Make fallback access immediate | AAC access needs vary over time and by fatigue. | Needs, feelings, favorites, saved replies, hold-the-floor, and device speech remain locally available when offline or model replies are unavailable. |

## Lightweight runtime budget

Cadence should keep ordinary use light. Live microphone captions and eye-gaze are opt-in and are the only features that should request device media.

| Area | Current guardrail | Why it matters |
| --- | --- | --- |
| Initial load | MediaPipe is dynamically imported only after a person chooses eye-gaze. | A normal conversation session does not download camera inference code or the face model. |
| Camera | 480 by 360 preferred camera input, 15 to 20 fps capture, no audio. | Lower capture cost than high-resolution video is sufficient for this experimental focus aid. |
| Landmark inference | A user can choose steady, balanced, or fast focus speed. Balanced runs at most once per 200 ms with 250 ms feature updates; all modes apply smoothing and a movement threshold. | Lets the person trade responsiveness for steadiness while limiting main-thread work and jittery focus changes. |
| Background tabs | Landmark inference pauses while the document is hidden. | Avoids needless battery and CPU use when Cadence is not visible. |
| Gaze selection | Raw pointer is only feedback. An actionable target must remain nearest for about 180 ms before selection focus appears. | Prevents the pointer from implying that an unrelated or stale target will be selected. |
| Network failure | Local phrases, saved replies, and device voice remain usable. | Conversation support should degrade gracefully rather than leave the person without a way to communicate. |

MediaPipe documents that `detectForVideo()` is synchronous and can block the UI thread; a Web Worker is the appropriate next performance upgrade if field testing shows this throttled implementation remains heavy on target devices. See [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

## UX review checklist

- Keep Listen as the main visible control. Keep Eye gaze visible but secondary, because it is optional and needs consent and calibration.
- Do not add more actions to the reply-card area. Use progressive disclosure for preferences, personalization, and debugging.
- Show direct, human recovery messages: listening paused, replies unavailable, or gaze cannot see a face.
- Keep every high-consequence action confirmable and reversible. Gaze must never speak without an explicit confirmation.
- Test all changes at 375 px portrait, keyboard only, switch scanning, screen reader, offline, and a low-powered laptop or tablet.
- Measure session performance during tester sessions: time to first reply, response latency, rejected suggestions, edits, and user-rated confidence. Do not infer clinical benefit from internal metrics alone.

## Planned validation

1. Ask 5 to 10 voluntary testers to try touch, keyboard, and if appropriate eye-gaze.
2. Record consented, non-sensitive feedback about fatigue, false focus, clarity of the off switch, and whether the visible gaze control is easy to find.
3. Profile the app on representative tablets. Move MediaPipe inference into a worker only if measured main-thread blocking remains material.
4. Keep claims on the landing page limited to the design intent until feedback supports stronger language.
