type GazeFeature = { x: number; y: number; confidence: number };
type Landmark = { x: number; y: number };
type WorkerScope = {
  onmessage: ((event: MessageEvent<{ type: "init" } | { type: "frame"; frame: ImageBitmap } | { type: "close" }>) => void) | null;
  postMessage: (message: unknown) => void;
};

const scope = self as unknown as WorkerScope;
const wasmRoot = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
let landmarker: { detect: (image: ImageBitmap) => { faceLandmarks: Landmark[][] }; close: () => void } | null = null;
let isInitializing = false;

function featureFromLandmarks(landmarks: Landmark[]): GazeFeature | null {
  if (landmarks.length < 478) return null;
  const average = (points: Landmark[]) => points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  const relative = (value: number, first: number, second: number) => {
    const minimum = Math.min(first, second);
    const span = Math.abs(second - first);
    return span > 0.0001 ? (value - minimum) / span : 0.5;
  };
  const eyeWidth = Math.abs(landmarks[263].x - landmarks[33].x);
  if (eyeWidth < 0.03) return null;
  const left = average(landmarks.slice(468, 473));
  const right = average(landmarks.slice(473, 478));
  return {
    x: (relative(left.x, landmarks[33].x, landmarks[133].x) + relative(right.x, landmarks[362].x, landmarks[263].x)) / 2,
    y: (relative(left.y, landmarks[159].y, landmarks[145].y) + relative(right.y, landmarks[386].y, landmarks[374].y)) / 2,
    confidence: Math.min(1, eyeWidth / 0.16),
  };
}

async function initialize() {
  if (landmarker || isInitializing) return;
  isInitializing = true;
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks(wasmRoot);
    landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath },
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });
    scope.postMessage({ type: "ready" });
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Local gaze worker could not start." });
  } finally {
    isInitializing = false;
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    void initialize();
    return;
  }
  if (message.type === "close") {
    landmarker?.close();
    landmarker = null;
    return;
  }
  if (message.type !== "frame") return;
  const frame = message.frame;
  try {
    if (!landmarker) {
      scope.postMessage({ type: "error", message: "Local gaze worker is not ready." });
      return;
    }
    const feature = featureFromLandmarks(landmarker.detect(frame).faceLandmarks[0] ?? []);
    scope.postMessage(feature ? { type: "feature", feature } : { type: "no-face", message: "Face not found. Keep your face centered and well lit." });
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Local gaze worker could not read the camera frame." });
  } finally {
    frame.close();
  }
};