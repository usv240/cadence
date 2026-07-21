# Eye-Gaze Next Steps

## Current boundary

Cadence's local-camera eye-gaze focus is an experimental, confirmation-only access aid. It uses MediaPipe face and iris landmarks, a five-point calibration, and focus snapping to large actions. It is not a general cursor, dedicated eye-tracking hardware, or a medical device.

## Why the current beta is unstable

- A calibration capture records one frame, so blink, camera noise, or head movement can distort a sample.
- The current feature uses iris position relative to eye corners but does not compensate for head yaw, pitch, roll, distance, or camera position.
- MediaPipe Face Landmarker provides face and iris landmarks, not a production gaze-vector estimate.
- Five samples feed a simple linear mapping, while webcam gaze behavior across a display is nonlinear.
- Current confidence is mainly a face-size signal, not a measured gaze-accuracy score.
- The lightweight 480 by 360, 12 to 15 fps camera configuration protects battery and responsiveness but limits iris precision.

## Proposed implementation

Build target-based gaze selection, not a general-purpose mouse pointer.

1. Use joint features: left/right iris position, eye openness, face scale, and head yaw, pitch, and roll.
2. Request MediaPipe facial transformation output or calculate head pose from stable face landmarks.
3. Replace each single-frame capture with about one second of stable samples.
4. Reject blinks, low-confidence frames, rapid head movement, and high-variance samples.
5. Use the median of accepted samples for each target.
6. Calibrate against nine targets: corners, edge midpoints, and center.
7. Fit and validate a mapping using held-out targets, then show a real validation score.
8. Add dead zones, hysteresis, and dwell before a focus target changes.
9. Snap only among visible, large, actionable controls.
10. Continue requiring an explicit Select button, Space, or Enter before any speech action.

## Acceptance criteria

- Camera start, stop, permission denial, and retry are deterministic and release resources.
- Calibration cannot advance from a low-quality or unstable sample.
- A user can see the active target and current calibration progress on a 375 px phone.
- Gaze focus remains stable when the user briefly looks between nearby choices.
- No action speaks automatically from gaze.
- Testing includes voluntary feedback on accuracy, setup burden, fatigue, and accidental selections.
- The feature remains labelled beta until repeated real-user testing supports broader claims.

## Research and product boundary

Use the same evidence boundaries described in `docs/RESEARCH-IMPLEMENTATION.md`. Do not claim that this feature matches dedicated eye-gaze hardware or reduces fatigue without comparable user testing.
