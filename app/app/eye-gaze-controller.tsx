"use client";

import { useEffect, useRef } from "react";
import type { GazeFeature, GazeFocusSpeed } from "@/lib/eye-gaze";

type Status = "off" | "starting" | "ready" | "no-face" | "unsupported" | "error";

type Props = {
  active: boolean;
  speed: GazeFocusSpeed;
  onFeature: (feature: GazeFeature) => void;
  onStatus: (status: Status, message?: string) => void;
};

type Landmark = { x: number; y: number };
type WorkerMessage =
  | { type: "ready" }
  | { type: "feature"; feature: GazeFeature }
  | { type: "no-face"; message: string }
  | { type: "error"; message: string };

const wasmRoot = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const speedSettings = {
  steady: { processingIntervalMs: 260, featureUpdateIntervalMs: 320, smoothingFactor: 0.1 },
  balanced: { processingIntervalMs: 200, featureUpdateIntervalMs: 250, smoothingFactor: 0.12 },
  responsive: { processingIntervalMs: 140, featureUpdateIntervalMs: 180, smoothingFactor: 0.2 },
} as const;

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

export type EyeGazeStatus = Status;

export function EyeGazeController({ active, speed, onFeature, onStatus }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speedRef = useRef(speed);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!active) {
      onStatus("off");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onStatus("unsupported", "This browser cannot provide camera access for eye-gaze focus.");
      return;
    }

    let cancelled = false;
    let frameId = 0;
    let stream: MediaStream | null = null;
    let landmarker: { detectForVideo: (image: HTMLVideoElement, timestamp: number) => { faceLandmarks: Landmark[][] }; close: () => void } | null = null;
    let worker: Worker | null = null;
    let workerReady = false;
    let workerBusy = false;
    let fallbackStarted = false;
    let lastProcessedAt = 0;
    let lastEmittedAt = 0;
    let smoothedFeature: GazeFeature | null = null;
    let faceWasDetected = false;

    const handleFeature = (rawFeature: GazeFeature, timestamp: number) => {
      const tuning = speedSettings[speedRef.current];
      const previousFeature = smoothedFeature;
      smoothedFeature = previousFeature
        ? {
          x: previousFeature.x + (rawFeature.x - previousFeature.x) * tuning.smoothingFactor,
          y: previousFeature.y + (rawFeature.y - previousFeature.y) * tuning.smoothingFactor,
          confidence: previousFeature.confidence + (rawFeature.confidence - previousFeature.confidence) * tuning.smoothingFactor,
        }
        : rawFeature;
      if (timestamp - lastEmittedAt >= tuning.featureUpdateIntervalMs) {
        lastEmittedAt = timestamp;
        onFeature(smoothedFeature);
      }
      if (!faceWasDetected) onStatus("ready");
      faceWasDetected = true;
    };

    const reportNoFace = (message: string) => {
      if (faceWasDetected) onStatus("no-face", message);
      faceWasDetected = false;
    };

    const startMainThreadInference = async () => {
      if (fallbackStarted || cancelled) return;
      fallbackStarted = true;
      worker?.terminate();
      worker = null;
      try {
        onStatus("starting", "Loading a compatible local gaze model...");
        const vision = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        const files = await vision.FilesetResolver.forVisionTasks(wasmRoot);
        landmarker = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.65,
          minFacePresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });
        if (!cancelled) onStatus("ready");
      } catch (error) {
        if (!cancelled) onStatus("error", error instanceof Error ? error.message : "Local gaze setup did not finish.");
      }
    };

    const process = (timestamp: number) => {
      if (cancelled || document.visibilityState !== "visible") {
        frameId = window.requestAnimationFrame(process);
        return;
      }
      const tuning = speedSettings[speedRef.current];
      if (timestamp - lastProcessedAt >= tuning.processingIntervalMs) {
        lastProcessedAt = timestamp;
        const video = videoRef.current;
        if (workerReady && worker && !workerBusy && video?.readyState && typeof createImageBitmap === "function") {
          workerBusy = true;
          void createImageBitmap(video).then((frame) => {
            if (cancelled || !worker) {
              frame.close();
              return;
            }
            worker.postMessage({ type: "frame", frame }, [frame]);
          }).catch(() => {
            workerBusy = false;
            void startMainThreadInference();
          });
        } else if (landmarker && video) {
          const rawFeature = featureFromLandmarks(landmarker.detectForVideo(video, timestamp).faceLandmarks[0] ?? []);
          if (rawFeature) handleFeature(rawFeature, timestamp);
          else reportNoFace("Face not found. Keep your face centered and well lit.");
        }
      }
      frameId = window.requestAnimationFrame(process);
    };

    const run = async () => {
      try {
        onStatus("starting", "Requesting local camera...");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (typeof Worker === "undefined" || typeof createImageBitmap !== "function") {
          await startMainThreadInference();
        } else {
          worker = new Worker(new URL("./eye-gaze.worker.ts", import.meta.url), { type: "module" });
          worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            if (cancelled) return;
            const message = event.data;
            if (message.type === "ready") {
              workerReady = true;
              onStatus("ready");
              return;
            }
            workerBusy = false;
            if (message.type === "feature") handleFeature(message.feature, performance.now());
            if (message.type === "no-face") reportNoFace(message.message);
            if (message.type === "error") void startMainThreadInference();
          };
          worker.onerror = () => {
            workerBusy = false;
            void startMainThreadInference();
          };
          worker.postMessage({ type: "init" });
        }
        frameId = window.requestAnimationFrame(process);
      } catch (error) {
        if (!cancelled) onStatus("error", error instanceof Error ? error.message : "Camera setup did not finish.");
      }
    };
    void run();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      worker?.terminate();
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, onFeature, onStatus]);

  return <video ref={videoRef} className="sr-only" muted playsInline aria-hidden="true" />;
}