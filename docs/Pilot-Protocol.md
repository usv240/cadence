# Cadence pilot protocol

Cadence is an early assistive-communication prototype, not a medical device or emergency tool. This lightweight protocol is for voluntary usability feedback, not clinical validation.

## Before a session

- Use `MOCK_MODE=1` unless the participant explicitly wants to try real mode and has reviewed the in-app data notice.
- Do not ask participants to share diagnoses, private health information, passwords, API keys, names, or real conversation transcripts.
- Explain that they can stop at any time and may use fictional names and situations.

## Three five-minute tasks

1. **Respond:** play the demo conversation or speak a fictional prompt. Ask the participant to choose or edit a reply and speak it.
2. **Initiate:** ask the participant to use **Start something** to bring up a topic on their own terms.
3. **Fallback:** ask the participant to find and speak a phrase from **My needs** or the offline backup board.

If relevant, ask the participant to try one access feature: keyboard, scanning, large Select control, or device voice.

## Record only these observations

| Measure | How to capture it |
| --- | --- |
| Task completion | Completed, completed with help, or not completed. |
| Time to first spoken reply | Use the optional local debug recording; note only the duration, not transcript text. |
| Perceived fit | Ask: “Did any reply sound like something you would say?” (Yes / partly / no). |
| Confidence and safety | Ask: “What felt confusing, slow, inaccessible, or unsafe?” |
| One priority | Ask: “What should we improve first?” |

## Reporting results

- Report the number and role of participants, not identifying information.
- Quote feedback only with permission and remove details that could identify a person.
- Separate observations from claims: say “2 of 3 testers completed the response task” rather than claiming clinical benefit.
- Treat feedback from people who use AAC, caregivers, and SLPs as design input; do not represent Cadence as clinically validated.

## Acceptance criteria for the next build

- A participant can reach a first spoken phrase without setup help.
- A participant can find an essential fallback phrase while offline.
- Any serious confusion, unsafe action, or access barrier becomes a prioritized issue before a wider launch.
