import assert from "node:assert/strict";
import test from "node:test";
import { validateString, validateTranscript } from "../lib/api-guard";
import { defaultConversationSettings, sanitizeConversationSettings } from "../lib/conversation-settings";
import { buildGazeCalibration, estimateGazePoint, sanitizeEyeGazeSettings } from "../lib/eye-gaze";
import { LOCAL_SESSION_TTL_MS, readLocalSession } from "../lib/local-session";
import { emptyConversationMemory, updateConversationMemory, validateConversationMemory } from "../lib/memory";

const now = 1_720_000_000_000;

function validSession(savedAt = now) {
  return JSON.stringify({
    savedAt,
    transcript: [{ id: "turn-1", speaker: "Maya", text: "Would a picnic work?", time: "7:42 PM", color: "blue" }],
    spoken: [{ id: "spoken-1", text: "That sounds lovely.", time: "7:43 PM", impact: { secondsSaved: 12 } }],
    suggestions: [{ id: "suggestion-1", label: "Agree", text: "That sounds lovely.", accent: "mint" }],
    baseSuggestions: [{ id: "suggestion-1", label: "Agree", text: "That sounds lovely.", accent: "mint" }],
    suggestionMode: "reply",
  });
}

test("local sessions restore only valid, unexpired conversation data", () => {
  const session = readLocalSession(validSession(), now);
  assert.equal(session?.transcript[0]?.speaker, "Maya");
  assert.equal(session?.spoken[0]?.text, "That sounds lovely.");
  assert.equal(readLocalSession(validSession(now - LOCAL_SESSION_TTL_MS - 1), now), null);
  assert.equal(readLocalSession('{"savedAt":"not-a-date"}', now), null);
});

test("conversation settings discard unsafe values and normalize personal lists", () => {
  const settings = sanitizeConversationSettings({
    mode: "doctor",
    energy: "low",
    peopleHere: ["Maya", "maya", " Jon ", 42],
    topicsToAvoid: ["finances"],
    scanIntervalMs: 999,
    privateSession: "yes",
  });
  assert.equal(settings.mode, "doctor");
  assert.equal(settings.energy, "low");
  assert.deepEqual(settings.peopleHere, ["Maya", "Jon"]);
  assert.equal(settings.scanIntervalMs, defaultConversationSettings.scanIntervalMs);
  assert.equal(settings.privateSession, true);
});

test("local memory keeps distinct people and useful topics within its cap", () => {
  const memory = updateConversationMemory(emptyConversationMemory, [
    { speaker: "Maya", text: "Maya mentioned a picnic and gardening today." },
    { speaker: "Jon", text: "A picnic sounds wonderful, Maya." },
  ]);
  assert.deepEqual(memory.people, ["Maya", "Jon"]);
  assert.ok(memory.topics.includes("picnic"));
  assert.equal(validateConversationMemory({ people: Array(13).fill("Person"), topics: [] }), "memory.people must contain up to 12 short strings.");
});

test("eye-gaze calibration estimates locally and rejects malformed saved values", () => {
  const calibration = buildGazeCalibration([
    { x: 0, y: 0, targetX: 0.1, targetY: 0.2, confidence: 1 },
    { x: 1, y: 0, targetX: 0.9, targetY: 0.2, confidence: 1 },
    { x: 0, y: 1, targetX: 0.1, targetY: 0.8, confidence: 1 },
    { x: 1, y: 1, targetX: 0.9, targetY: 0.8, confidence: 1 },
    { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, confidence: 1 },
  ]);
  assert.ok(calibration);
  const point = estimateGazePoint({ x: 0.5, y: 0.5, confidence: 0.8 }, calibration);
  if (!point) throw new Error('Expected a calibrated gaze point.');
  assert.ok(Math.abs(point.x - 0.5) < 0.01);
  assert.ok(Math.abs(point.y - 0.5) < 0.01);
  assert.deepEqual(sanitizeEyeGazeSettings({ consented: true, calibration: { x: [1], y: [1, 2, 3], samples: 5, createdAt: now } }), { consented: true, calibration: null, speed: "balanced" });
  assert.equal(sanitizeEyeGazeSettings({ consented: true, calibration: null, speed: "steady" }).speed, "steady");
});

test("model input validation rejects oversized or incomplete context", () => {
  assert.equal(validateTranscript([]), "transcript is required.");
  assert.equal(validateTranscript(Array.from({ length: 21 }, () => ({ speaker: "Room", text: "Hello" }))), "transcript must contain 20 turns or fewer.");
  assert.equal(validateString("x".repeat(41), 40, "keyword"), "keyword must contain 40 characters or fewer.");
});
