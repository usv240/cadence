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

const wasmRoot = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const modelLoadTimeoutMs = 15000;
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

function describeCameraError(error: unknown) {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : "Local gaze setup did not finish.";
  if (error.name === "NotAllowedError") return "Camera access was not allowed. Use the camera icon in the browser address bar, allow access, then try again.";
  if (error.name === "NotFoundError") return "No camera was found. Connect or enable a camera, then try again.";
  if (error.name === "NotReadableError") return "Another app is using the camera. Close it, then try again.";
  return error.message || "Cadence could not start the local camera.";
}

async function waitForVideo(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("The camera did not provide video in time.")), 8000);
    const ready = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.addEventListener("loadeddata", ready, { once: true });
  });
}

async function withTimeout<T>(operation: Promise<T>, message: string) {
  let timeoutId = 0;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), modelLoadTimeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
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
    let lastProcessedAt = 0;
    let lastEmittedAt = 0;
    let smoothedFeature: GazeFeature | null = null;
    let faceWasDetected = false;
    let noFaceWasReported = false;

    const reportFeature = (rawFeature: GazeFeature, timestamp: number) => {
      const tuning = speedSettings[speedRef.current];
      const previousFeature = smoothedFeature;
      smoothedFeature = previousFeature
        ? {
          x: previousFeature.x + (rawFeature.x - previousFeature.x) * tuning.smoothingFactor,
          y: previousFeature.y + (rawFeature.y - previousFeature.y) * tuning.smoothingFactor,
          confidence: previousFeature.confidence + (rawFeature.confidence - previousFeature.confidence) * tuning.smoothingFactor,
        }
        : rawFeature;
      if (!faceWasDetected || noFaceWasReported) onStatus("ready", "Face found. Look at the target, then capture once.");
      faceWasDetected = true;
      noFaceWasReported = false;
      if (timestamp - lastEmittedAt >= tuning.featureUpdateIntervalMs) {
        lastEmittedAt = timestamp;
        onFeature(smoothedFeature);
      }
    };

    const reportNoFace = () => {
      if (!noFaceWasReported) onStatus("no-face", "Face not found. Keep your face centered and well lit.");
      faceWasDetected = false;
      noFaceWasReported = true;
    };

    const process = (timestamp: number) => {
      if (cancelled) return;
      const tuning = speedSettings[speedRef.current];
      const video = videoRef.current;
      if (document.visibilityState === "visible" && landmarker && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && timestamp - lastProcessedAt >= tuning.processingIntervalMs) {
        lastProcessedAt = timestamp;
        try {
          const feature = featureFromLandmarks(landmarker.detectForVideo(video, timestamp).faceLandmarks[0] ?? []);
          if (feature) reportFeature(feature, timestamp);
          else reportNoFace();
        } catch (error) {
          onStatus("error", describeCameraError(error));
          return;
        }
      }
      frameId = window.requestAnimationFrame(process);
    };

    const run = async () => {
      try {
        onStatus("starting", "Requesting local camera...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 12, max: 15 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) throw new Error("Camera preview was not available.");
        video.srcObject = stream;
        await video.play();
        await waitForVideo(video);
        if (cancelled) return;
        onStatus("starting", "Camera connected. Starting local gaze detection...");
        onStatus("starting", "Loading the local gaze model...");
        const vision = await withTimeout(import("@mediapipe/tasks-vision"), "The local gaze model could not load. Check your connection, then try again.");
        if (cancelled) return;
        const files = await withTimeout(vision.FilesetResolver.forVisionTasks(wasmRoot), "The local gaze model could not start. Check your connection, then try again.");
        landmarker = await withTimeout(vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.55,
          minFacePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        }), "The local gaze model took too long to start. Check your connection, then try again.");
        if (cancelled) return;
        onStatus("ready", "Camera is ready. Look at the highlighted target, then capture once.");
        frameId = window.requestAnimationFrame(process);
      } catch (error) {
        if (!cancelled) {
          window.cancelAnimationFrame(frameId);
          landmarker?.close();
          landmarker = null;
          stream?.getTracks().forEach((track) => track.stop());
          stream = null;
          onStatus("error", describeCameraError(error));
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, onFeature, onStatus]);

  return <video ref={videoRef} className="sr-only" autoPlay muted playsInline aria-hidden="true" />;
}