"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { transcribe, transcribeOnce, type BrowserTranscriber, type LiveTranscriptionStatus } from "@/lib/browser-transcribe";
import { candidatesToSuggestions, conversationService, RealModeConsentRequiredError, RequestTimeoutError } from "@/lib/conversation-service";
import { neutralStyleCard } from "@/lib/style-card";
import { AAC_TYPING_WORDS_PER_MINUTE, calculateReplyImpact, calculateSessionImpact } from "@/lib/impact";
import { emptyPersonalProfile, type PersonalProfile } from "@/lib/profile";
import { emptyConversationMemory, updateConversationMemory, type ConversationMemory } from "@/lib/memory";
import { defaultNeeds, sanitizeNeeds, maxNeedLength } from "@/lib/needs";
import { defaultFeelings, sanitizeFeelings, maxFeelingLength } from "@/lib/feelings";
import { defaultRepairPhrases, repairPhrasesKey, sanitizeRepairPhrases, maxRepairPhraseLength } from "@/lib/repair-phrases";
import { emptyHelpPlan, helpPlanKey, sanitizeHelpPlan, maxHelpPlanLength, type HelpPlan } from "@/lib/help-plan";
import { appendDebugEvent, debugEnabledKey, debugLogKey, readDebugEvents, type DebugEvent } from "@/lib/debug-log";
import { emptyReplyPreferences, sanitizeReplyPreferences, type ReplyPreferences } from "@/lib/reply-preferences";
import { defaultConversationSettings, sanitizeConversationSettings, type ConversationSettings } from "@/lib/conversation-settings";
import { conversationKitsKey, sanitizeConversationKits, type ConversationKit } from "@/lib/conversation-kits";
import { applyPersonalVocabulary, formatPersonalVocabulary, parsePersonalVocabulary, personalVocabularyKey, sanitizePersonalVocabulary, type PersonalVocabularyEntry } from "@/lib/personal-vocabulary";
import { offlineExpand, offlineInitiate, offlinePredict, offlineToneAdjust } from "@/lib/offline-fallback";
import { defaultTtsVoice, isTtsVoice, ttsVoiceOptions, type TtsVoice } from "@/lib/voices";
import { localSessionKey, readLocalSession } from "@/lib/local-session";
import { buildGazeCalibration, emptyEyeGazeSettings, estimateGazePoint, eyeGazeSettingsKey, gazeFocusSpeeds, sanitizeEyeGazeSettings, type EyeGazeSettings, type GazeCalibration, type GazeCalibrationSample, type GazeFeature, type GazeFocusSpeed } from "@/lib/eye-gaze";
import { EyeGazeController, type EyeGazeStatus } from "./eye-gaze-controller";
import { applyTheme, preferredTheme, themeStorageKey } from "@/lib/theme";
import { summarizeParticipation, type ParticipationEvent } from "@/lib/participation";
import type { Candidate, SpokenItem, Suggestion, Tone, TranscriptInput, TranscriptTurn } from "@/lib/conversation";

const initialTranscript: TranscriptTurn[] = [
  { id: "1", speaker: "Maya", text: "This pasta is officially going into the regular rotation.", time: "7:42 PM", color: "orange" },
  { id: "2", speaker: "Jon", text: "Agreed. And we should absolutely do something outside next weekend.", time: "7:42 PM", color: "blue" },
  { id: "3", speaker: "Lena", text: "A picnic? Or is that too ambitious for all of us?", time: "7:43 PM", color: "pink" },
];

const initialTranscriptInput = initialTranscript.map(({ speaker, text }) => ({ speaker, text }));
const tones: Tone[] = ["warm", "firm", "funny"];
const quickReplies = ["mm-hm", "right", "haha", "no way"];
const intents = ["Yes", "No", "one sec"];
/** Time each target remains highlighted in single-switch scanning mode. */
/** Default single-switch dwell interval; users can choose a slower or faster value. */
const SCAN_INTERVAL_MS = 1200;
/** Final captions wait briefly so recognition can finish the turn before prediction. */
const FINAL_CAPTION_PREDICTION_DEBOUNCE_MS = 150;
/** One stable interim caption can pre-warm a reply; final text always replaces it. */
const INTERIM_CAPTION_PREDICTION_DEBOUNCE_MS = 300;
/** Browser captions below this confidence require user confirmation before prediction. */
const TRANSCRIPT_CONFIDENCE_THRESHOLD = 0.75;
/** Short pauses are common in speech recognition, so wait before committing a partner turn. */
const PARTNER_TURN_SETTLE_MS = 1100;

function mergeCaptionFragments(current: string, next: string) {
  const first = current.trim();
  const second = next.trim();
  if (!first) return second;
  if (!second) return first;

  const normalise = (value: string) => value.toLocaleLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  const firstNormalised = normalise(first);
  const secondNormalised = normalise(second);
  if (firstNormalised === secondNormalised || firstNormalised.endsWith(secondNormalised)) return first;
  if (secondNormalised.startsWith(firstNormalised)) return second;

  const firstWords = first.split(/\s+/);
  const secondWords = second.split(/\s+/);
  const firstComparable = firstWords.map(normalise);
  const secondComparable = secondWords.map(normalise);
  for (let overlap = Math.min(firstComparable.length, secondComparable.length); overlap > 0; overlap -= 1) {
    if (firstComparable.slice(-overlap).join(" ") === secondComparable.slice(0, overlap).join(" ")) {
      return [...firstWords, ...secondWords.slice(overlap)].join(" ");
    }
  }
  return `${first} ${second}`;
}

type Theme = "light" | "dark";
type SpeechOutput = "openai" | "device";
const floorHoldingPhrases = ["Give me a second, I'd like to respond.", "One moment. I want to add something.", "Hold on a moment, I have a thought."];

export default function Home() {
  const [baseSuggestions, setBaseSuggestions] = useState<Suggestion[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tone, setTone] = useState<Tone>("warm");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [spoken, setSpoken] = useState<SpokenItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [isExpanding, setIsExpanding] = useState(false);
  const [isVoiceSteering, setIsVoiceSteering] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<"reply" | "initiate">("reply");
  const [predictionStatus, setPredictionStatus] = useState<"ready" | "preparing">("ready");
  const [error, setError] = useState("");
  const [listenStatus, setListenStatus] = useState<LiveTranscriptionStatus>("off");
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFirstSpeechAffirmation, setShowFirstSpeechAffirmation] = useState(false);
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showBackupBoard, setShowBackupBoard] = useState(false);
  const [selectedTranscriptTurn, setSelectedTranscriptTurn] = useState<TranscriptTurn | null>(null);
  const [speakerTurn, setSpeakerTurn] = useState<TranscriptTurn | null>(null);
  const [showNeeds, setShowNeeds] = useState(false);
  const [showFeelings, setShowFeelings] = useState(false);
  const [showRepairs, setShowRepairs] = useState(false);
  const [showHelpPlan, setShowHelpPlan] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPartnerGuide, setShowPartnerGuide] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [showConversationSetup, setShowConversationSetup] = useState(false);
  const [showConversationKits, setShowConversationKits] = useState(false);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [showEyeGazeSetup, setShowEyeGazeSetup] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [showQuickControls, setShowQuickControls] = useState(false);
  const [showFeelingControls, setShowFeelingControls] = useState(false);
  const [showRepairControls, setShowRepairControls] = useState(false);
  const [composerMode, setComposerMode] = useState<"generate" | "speak">("generate");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<"idle" | "preparing" | "playing">("idle");
  const [listeningFeedback, setListeningFeedback] = useState("");
  const [ttsVoice, setTtsVoice] = useState<TtsVoice>(defaultTtsVoice);
  const [speechOutput, setSpeechOutput] = useState<SpeechOutput>("openai");
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const [showSpoken, setShowSpoken] = useState(false);
  const [isScanningMode, setIsScanningMode] = useState(false);
  const [scanIndex, setScanIndex] = useState(0);
  const [eyeGazeSettings, setEyeGazeSettings] = useState<EyeGazeSettings>(emptyEyeGazeSettings);
  const [isEyeGazeActive, setIsEyeGazeActive] = useState(false);
  const [eyeGazeCameraRequested, setEyeGazeCameraRequested] = useState(false);
  const [eyeGazeRunId, setEyeGazeRunId] = useState(0);
  const [eyeGazeStatus, setEyeGazeStatus] = useState<EyeGazeStatus>("off");
  const [eyeGazeMessage, setEyeGazeMessage] = useState("");
  const [eyeGazeFeature, setEyeGazeFeature] = useState<GazeFeature | null>(null);
  const [gazeTargetIndex, setGazeTargetIndex] = useState<number | null>(null);
  const [gazeCandidateIndex, setGazeCandidateIndex] = useState<number | null>(null);
  const [gazeCursorPoint, setGazeCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [styleCard, setStyleCard] = useState(neutralStyleCard);
  const [profile, setProfile] = useState<PersonalProfile>(emptyPersonalProfile);
  const [memory, setMemory] = useState<ConversationMemory>(emptyConversationMemory);
  const [needs, setNeeds] = useState<string[]>(defaultNeeds);
  const [feelings, setFeelings] = useState<string[]>(defaultFeelings);
  const [repairPhrases, setRepairPhrases] = useState<string[]>(defaultRepairPhrases);
  const [helpPlan, setHelpPlan] = useState<HelpPlan>(emptyHelpPlan);
  const [debugRecordingEnabled, setDebugRecordingEnabled] = useState(false);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [replyPreferences, setReplyPreferences] = useState<ReplyPreferences>(emptyReplyPreferences);
  const [conversationSettings, setConversationSettings] = useState<ConversationSettings>(defaultConversationSettings);
  const [conversationKits, setConversationKits] = useState<ConversationKit[]>([]);
  const [personalVocabulary, setPersonalVocabulary] = useState<PersonalVocabularyEntry[]>([]);
  const [theme, setTheme] = useState<Theme>("light");
  const [hasRealModeConsent, setHasRealModeConsent] = useState(false);
  const [participationEvents, setParticipationEvents] = useState<ParticipationEvent[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [hasLearnedStyle, setHasLearnedStyle] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [contextUndo, setContextUndo] = useState<TranscriptTurn | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const liveTranscriber = useRef<BrowserTranscriber | null>(null);
  const voiceSteerTranscriber = useRef<BrowserTranscriber | null>(null);
  const resumeRoomListeningAfterSteer = useRef(false);
  const prefetchTimer = useRef<number | null>(null);
  const inFlightRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const predictionStartedAt = useRef<number | null>(null);
  const lastTranscriptText = useRef<string | undefined>();
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const interimPredictionStarted = useRef(false);
  const pendingPartnerCaption = useRef<{ text: string; confidence?: number } | null>(null);
  const partnerTurnSettleTimer = useRef<number | null>(null);
  const styleCardRef = useRef(neutralStyleCard);
  const profileRef = useRef<PersonalProfile>(emptyPersonalProfile);
  const memoryRef = useRef<ConversationMemory>(emptyConversationMemory);
  const floorPhraseIndex = useRef(0);
  const debugEnabledRef = useRef(false);
  const debugEventsRef = useRef<DebugEvent[]>([]);
  const replyPreferencesRef = useRef<ReplyPreferences>(emptyReplyPreferences);
  const conversationSettingsRef = useRef<ConversationSettings>(defaultConversationSettings);
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  const gazeTargetCandidateRef = useRef<{ id: string; startedAt: number } | null>(null);

  useEffect(() => {
    if (!showMore) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) setShowMore(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMore(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showMore]);
  const handleEyeGazeFeature = useCallback((feature: GazeFeature) => setEyeGazeFeature(feature), []);
  const handleEyeGazeStatus = useCallback((status: EyeGazeStatus, message?: string) => {
    setEyeGazeStatus(status);
    setEyeGazeMessage(message ?? "");
  }, []);

  const startEyeGazeCamera = useCallback(() => {
    setEyeGazeStatus("starting");
    setEyeGazeMessage("Requesting local camera...");
    setEyeGazeCameraRequested(true);
    setEyeGazeRunId((value) => value + 1);
  }, []);

  const closeActiveDialog = useCallback(() => {
    setShowOnboarding(false);
    setShowFirstSpeechAffirmation(false);
    setShowVoiceSetup(false);
    setShowProfileSetup(false);
    setShowMemory(false);
    setShowBackupBoard(false);
    setSelectedTranscriptTurn(null);
    setSpeakerTurn(null);
    setShowNeeds(false);
    setShowFeelings(false);
    setShowAbout(false);
    setShowPrivacy(false);
    setTutorialStep(null);
    setShowDebugLog(false);
    setShowConversationSetup(false);
    setShowConversationKits(false);
    setShowVocabulary(false);
    setShowEyeGazeSetup(false);
    setSelectedSuggestion(null);
    setShowVoicePicker(false);
    setShowSpoken(false);
    setShowPartnerGuide(false);
  }, []);

  const hasOpenDialog = Boolean(showOnboarding || showFirstSpeechAffirmation || showVoiceSetup || showProfileSetup || showMemory || showBackupBoard || selectedTranscriptTurn || speakerTurn || showNeeds || showFeelings || showAbout || showPartnerGuide || showPrivacy || tutorialStep !== null || showDebugLog || showConversationSetup || showConversationKits || showVocabulary || showEyeGazeSetup || selectedSuggestion || showVoicePicker || showSpoken);

  useEffect(() => {
    if (!hasOpenDialog) {
      modalReturnFocus.current?.focus();
      modalReturnFocus.current = null;
      return;
    }

    modalReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const dialog = dialogs.item(dialogs.length - 1);
      const focusable = dialog?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const dialog = dialogs.item(dialogs.length - 1);
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeActiveDialog, hasOpenDialog]);
  const personalVocabularyRef = useRef<PersonalVocabularyEntry[]>([]);
  const replyFeedbackRef = useRef<"more_like_me" | undefined>();
  const lastPartnerTurnAt = useRef(Date.now());
  const speakingRef = useRef(false);

  const recordDebugEvent = useCallback((type: string, data?: Record<string, unknown>) => {
    if (!debugEnabledRef.current || conversationSettingsRef.current.privateSession) return;
    const nextEvents = appendDebugEvent(debugEventsRef.current, type, data);
    debugEventsRef.current = nextEvents;
    window.localStorage.setItem(debugLogKey, JSON.stringify(nextEvents));
    setDebugEvents(nextEvents);
  }, []);

  const isConsentRequired = useCallback((serviceError: unknown) => serviceError instanceof RealModeConsentRequiredError, []);
  const shouldUseLocalFallback = useCallback((serviceError: unknown) => !navigator.onLine || serviceError instanceof RequestTimeoutError || serviceError instanceof TypeError, []);

  useEffect(() => {
    const openPrivacyNotice = () => setShowPrivacy(true);
    window.addEventListener("cadence:real-mode-consent-required", openPrivacyNotice);
    return () => window.removeEventListener("cadence:real-mode-consent-required", openPrivacyNotice);
  }, []);

  const applyPredictions = useCallback(async (sourceTranscript: TranscriptInput[], signal: AbortSignal | undefined, version: number) => {
    setIsRefreshing(true);
    setError("");
    if (!navigator.onLine) {
      const settings = conversationSettingsRef.current;
      const memory = settings.privateSession ? emptyConversationMemory : memoryRef.current;
      const candidates = offlinePredict({ transcript: sourceTranscript, profile: profileRef.current, memory, count: settings.energy === "low" ? 2 : 4 });
      const predictions = candidatesToSuggestions(candidates).filter((candidate) => !replyPreferencesRef.current.blockedPhrases.some((phrase) => candidate.text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())));
      setBaseSuggestions(predictions);
      setSuggestions(predictions);
      setSuggestionMode("reply");
      setPredictionStatus("ready");
      setError("Offline replies are ready on this device. Listening and live AI will resume when you reconnect.");
      setIsRefreshing(false);
      recordDebugEvent("offline_prediction_completed", { candidates, repliesReadyMs: predictionStartedAt.current === null ? null : Math.round(performance.now() - predictionStartedAt.current) });
      return;
    }
    recordDebugEvent("prediction_requested", { transcript: sourceTranscript, mode: "reply" });
    try {
      const settings = conversationSettingsRef.current;
      const memory = settings.privateSession ? emptyConversationMemory : memoryRef.current;
      const feedback = replyFeedbackRef.current;
      replyFeedbackRef.current = undefined;
      const { candidates } = await conversationService.predict({ transcript: sourceTranscript, styleCard: styleCardRef.current, profile: profileRef.current, memory, settings, feedback, n: settings.energy === "low" ? 2 : 4 }, signal);
      if (signal?.aborted || version !== requestVersion.current) return;
      const predictions = candidatesToSuggestions(candidates).filter((candidate) => !replyPreferencesRef.current.blockedPhrases.some((phrase) => candidate.text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())));
      setBaseSuggestions(predictions);
      setSuggestions(predictions);
      if (!settings.privateSession) window.localStorage.setItem("cadence.lastSuggestions", JSON.stringify(predictions));
      setSuggestionMode("reply");
      setPredictionStatus("ready");
      recordDebugEvent("prediction_completed", { candidates, settings, feedback, repliesReadyMs: predictionStartedAt.current === null ? null : Math.round(performance.now() - predictionStartedAt.current) });
    } catch (predictionError) {
      if (signal?.aborted || (predictionError instanceof DOMException && predictionError.name === "AbortError")) return;
      if (version === requestVersion.current) {
        if (isConsentRequired(predictionError)) return;
        if (shouldUseLocalFallback(predictionError)) {
          const settings = conversationSettingsRef.current;
          const memory = settings.privateSession ? emptyConversationMemory : memoryRef.current;
          const candidates = offlinePredict({ transcript: sourceTranscript, profile: profileRef.current, memory, count: settings.energy === "low" ? 2 : 4 });
          const predictions = candidatesToSuggestions(candidates).filter((candidate) => !replyPreferencesRef.current.blockedPhrases.some((phrase) => candidate.text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase())));
          setBaseSuggestions(predictions);
          setSuggestions(predictions);
          setSuggestionMode("reply");
          setPredictionStatus("ready");
          setError("Live replies are unavailable right now. Showing local replies instead.");
          recordDebugEvent("prediction_recovered_offline", { reason: predictionError instanceof Error ? predictionError.name : "network" });
          return;
        }
        const message = "Replies unavailable. Use quick phrases or your saved replies.";
        setError(message);
        recordDebugEvent("prediction_failed", { message });
      }
    } finally {
      if (version === requestVersion.current) setIsRefreshing(false);
    }
  }, [isConsentRequired, recordDebugEvent, shouldUseLocalFallback]);

  const queueSpeculativePrediction = useCallback((sourceTranscript: TranscriptInput[], delayMs = FINAL_CAPTION_PREDICTION_DEBOUNCE_MS) => {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    inFlightRequest.current?.abort();
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    predictionStartedAt.current = performance.now();
    setPredictionStatus("preparing");
    prefetchTimer.current = window.setTimeout(() => {
      const controller = new AbortController();
      inFlightRequest.current = controller;
      void applyPredictions(sourceTranscript, controller.signal, version).finally(() => {
        if (version === requestVersion.current) inFlightRequest.current = null;
      });
    }, delayMs);
  }, [applyPredictions]);

  const refreshPredictions = useCallback((sourceTranscript: TranscriptInput[]) => {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    inFlightRequest.current?.abort();
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    predictionStartedAt.current = performance.now();
    setPredictionStatus("preparing");
    void applyPredictions(sourceTranscript, undefined, version);
  }, [applyPredictions]);

  const rememberTranscript = useCallback((turns: TranscriptInput[]) => {
    if (conversationSettingsRef.current.privateSession) return;
    const nextMemory = updateConversationMemory(memoryRef.current, turns);
    if (nextMemory.people.join("|") === memoryRef.current.people.join("|") && nextMemory.topics.join("|") === memoryRef.current.topics.join("|")) return;
    memoryRef.current = nextMemory;
    window.localStorage.setItem("cadence.memory", JSON.stringify(nextMemory));
    setMemory(nextMemory);
  }, []);

  const commitTranscript = useCallback((nextTranscript: TranscriptTurn[]) => {
    transcriptRef.current = nextTranscript;
    setTranscript(nextTranscript);
  }, []);

  const appendPartnerTurn = useCallback((turn: TranscriptTurn) => {
    const normalizedTurn = { ...turn, text: applyPersonalVocabulary(turn.text, personalVocabularyRef.current) };
    const current = transcriptRef.current;
    if (current.at(-1)?.text === normalizedTurn.text) return;
    const updated = [...current.slice(-5), normalizedTurn];
    commitTranscript(updated);
    recordDebugEvent("transcript_turn_received", { turn: normalizedTurn });
    lastPartnerTurnAt.current = Date.now();
    rememberTranscript(updated.map(({ speaker, text }) => ({ speaker, text })));
    if (!turn.isUncertain) queueSpeculativePrediction(updated.filter((item) => !item.isUncertain).map(({ speaker, text }) => ({ speaker, text })));
  }, [commitTranscript, queueSpeculativePrediction, recordDebugEvent, rememberTranscript]);

  const bufferPartnerTurn = useCallback((text: string, confidence?: number) => {
    const correctedText = applyPersonalVocabulary(text, personalVocabularyRef.current);
    const pending = pendingPartnerCaption.current;
    const combinedText = mergeCaptionFragments(pending?.text ?? "", correctedText);
    const combinedConfidence = typeof confidence === "number" ? confidence : pending?.confidence;
    pendingPartnerCaption.current = { text: combinedText, confidence: combinedConfidence };
    setListeningFeedback(`Finishing thought: ${combinedText}`);
    recordDebugEvent("transcript_turn_buffered", { text: combinedText });

    if (partnerTurnSettleTimer.current) window.clearTimeout(partnerTurnSettleTimer.current);
    partnerTurnSettleTimer.current = window.setTimeout(() => {
      const completedTurn = pendingPartnerCaption.current;
      pendingPartnerCaption.current = null;
      partnerTurnSettleTimer.current = null;
      interimPredictionStarted.current = false;
      if (!completedTurn?.text) return;

      setListeningFeedback("Heard that. Preparing replies.");
      appendPartnerTurn({
        id: crypto.randomUUID(),
        speaker: "Room",
        text: completedTurn.text,
        time: currentTime(),
        color: "blue",
        confidence: completedTurn.confidence,
        isUncertain: typeof completedTurn.confidence === "number" && completedTurn.confidence < TRANSCRIPT_CONFIDENCE_THRESHOLD,
      });
    }, PARTNER_TURN_SETTLE_MS);
  }, [appendPartnerTurn, recordDebugEvent]);

  useEffect(() => {
    const savedStyle = window.localStorage.getItem("cadence.styleCard");
    setHasRealModeConsent(window.localStorage.getItem("cadence.realModeConsent") === "1");
    const savedTone = window.localStorage.getItem("cadence.tone");
    if (savedTone === "warm" || savedTone === "firm" || savedTone === "funny") setTone(savedTone);
    const savedVoice = window.localStorage.getItem("cadence.ttsVoice");
    if (isTtsVoice(savedVoice)) setTtsVoice(savedVoice);
    if (window.localStorage.getItem("cadence.speechOutput") === "device") setSpeechOutput("device");
    const savedSuggestions = window.localStorage.getItem("cadence.lastSuggestions");
    if (savedSuggestions) {
      try {
        const cached = JSON.parse(savedSuggestions) as Suggestion[];
        if (Array.isArray(cached) && cached.every((item) => typeof item?.id === "string" && typeof item.text === "string" && typeof item.label === "string" && typeof item.accent === "string")) {
          setBaseSuggestions(cached);
          setSuggestions(cached);
          setPredictionStatus("ready");
        }
      } catch { window.localStorage.removeItem("cadence.lastSuggestions"); }
    }
    const savedSession = readLocalSession(window.localStorage.getItem(localSessionKey));
    if (savedSession) {
      transcriptRef.current = savedSession.transcript;
      setTranscript(savedSession.transcript);
      setSpoken(savedSession.spoken);
      setBaseSuggestions(savedSession.baseSuggestions);
      setSuggestions(savedSession.suggestions);
      setSuggestionMode(savedSession.suggestionMode);
      setPredictionStatus("ready");
    } else if (window.localStorage.getItem(localSessionKey)) {
      window.localStorage.removeItem(localSessionKey);
    }
    const savedReplyPreferences = window.localStorage.getItem("cadence.replyPreferences");
    if (savedReplyPreferences) {
      try { const preferences = sanitizeReplyPreferences(JSON.parse(savedReplyPreferences)); replyPreferencesRef.current = preferences; setReplyPreferences(preferences); } catch { window.localStorage.removeItem("cadence.replyPreferences"); }
    }
    const savedConversationSettings = window.localStorage.getItem("cadence.conversationSettings");
    if (savedConversationSettings) {
      try { const settings = sanitizeConversationSettings(JSON.parse(savedConversationSettings)); conversationSettingsRef.current = settings; setConversationSettings(settings); } catch { window.localStorage.removeItem("cadence.conversationSettings"); }
    }
    const savedEyeGaze = window.localStorage.getItem(eyeGazeSettingsKey);
    if (savedEyeGaze) {
      try { setEyeGazeSettings(sanitizeEyeGazeSettings(JSON.parse(savedEyeGaze))); } catch { window.localStorage.removeItem(eyeGazeSettingsKey); }
    }
    const savedConversationKits = window.localStorage.getItem(conversationKitsKey);
    if (savedConversationKits) {
      try { setConversationKits(sanitizeConversationKits(JSON.parse(savedConversationKits))); } catch { window.localStorage.removeItem(conversationKitsKey); }
    }
    const savedVocabulary = window.localStorage.getItem(personalVocabularyKey);
    if (savedVocabulary) {
      try { const vocabulary = sanitizePersonalVocabulary(JSON.parse(savedVocabulary)); personalVocabularyRef.current = vocabulary; setPersonalVocabulary(vocabulary); } catch { window.localStorage.removeItem(personalVocabularyKey); }
    }
    const enabled = window.localStorage.getItem(debugEnabledKey) === "1";
    const events = readDebugEvents(window.localStorage.getItem(debugLogKey));
    debugEnabledRef.current = enabled;
    debugEventsRef.current = events;
    setDebugRecordingEnabled(enabled);
    setDebugEvents(events);
    if (savedStyle) {
      styleCardRef.current = savedStyle;
      setStyleCard(savedStyle);
      setHasLearnedStyle(true);
    }
    const savedProfile = window.localStorage.getItem("cadence.profile");
    if (savedProfile) {
      try { const nextProfile = { ...emptyPersonalProfile, ...JSON.parse(savedProfile) as Partial<PersonalProfile> }; profileRef.current = nextProfile; setProfile(nextProfile); } catch { window.localStorage.removeItem("cadence.profile"); }
    }
    const savedMemory = window.localStorage.getItem("cadence.memory");
    if (savedMemory) {
      try { const nextMemory = { ...emptyConversationMemory, ...JSON.parse(savedMemory) as Partial<ConversationMemory> }; memoryRef.current = nextMemory; setMemory(nextMemory); } catch { window.localStorage.removeItem("cadence.memory"); }
    }
    const savedNeeds = window.localStorage.getItem("cadence.needs");
    if (savedNeeds) {
      try { setNeeds(sanitizeNeeds(JSON.parse(savedNeeds))); } catch { window.localStorage.removeItem("cadence.needs"); }
    } else window.localStorage.setItem("cadence.needs", JSON.stringify(defaultNeeds));
    const savedFeelings = window.localStorage.getItem("cadence.feelings");
    if (savedFeelings) {
      try { setFeelings(sanitizeFeelings(JSON.parse(savedFeelings))); } catch { window.localStorage.removeItem("cadence.feelings"); }
    } else window.localStorage.setItem("cadence.feelings", JSON.stringify(defaultFeelings));
    const savedRepairPhrases = window.localStorage.getItem(repairPhrasesKey);
    if (savedRepairPhrases) {
      try { setRepairPhrases(sanitizeRepairPhrases(JSON.parse(savedRepairPhrases))); } catch { window.localStorage.removeItem(repairPhrasesKey); }
    } else window.localStorage.setItem(repairPhrasesKey, JSON.stringify(defaultRepairPhrases));
    const savedHelpPlan = window.localStorage.getItem(helpPlanKey);
    if (savedHelpPlan) {
      try { setHelpPlan(sanitizeHelpPlan(JSON.parse(savedHelpPlan))); } catch { window.localStorage.removeItem(helpPlanKey); }
    }
    if (!window.localStorage.getItem("cadence.onboardingComplete")) setShowOnboarding(true);
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
    rememberTranscript(transcript.map(({ speaker, text }) => ({ speaker, text })));
  }, [rememberTranscript, transcript]);

  useEffect(() => {
    if (!sessionRestored) return;
    if (conversationSettings.privateSession) {
      window.localStorage.removeItem(localSessionKey);
      window.localStorage.removeItem("cadence.lastSuggestions");
      return;
    }
    if (!transcript.length && !spoken.length && !suggestions.length) {
      window.localStorage.removeItem(localSessionKey);
      return;
    }
    window.localStorage.setItem(localSessionKey, JSON.stringify({ savedAt: Date.now(), transcript, spoken, suggestions, baseSuggestions, suggestionMode }));
  }, [baseSuggestions, conversationSettings.privateSession, sessionRestored, spoken, suggestionMode, suggestions, transcript]);

  useEffect(() => {
    liveTranscriber.current = transcribe(
      (text, confidence) => bufferPartnerTurn(text, confidence),
      setListenStatus,
      setError,
      (text) => {
        const correctedText = applyPersonalVocabulary(text, personalVocabularyRef.current);
        const combinedText = mergeCaptionFragments(pendingPartnerCaption.current?.text ?? "", correctedText);
        setListeningFeedback(`Hearing: ${combinedText}`);
        const hasEnoughContext = combinedText.trim().split(/\s+/).length >= 6 || combinedText.trim().length >= 28;
        if (interimPredictionStarted.current || !hasEnoughContext) return;
        interimPredictionStarted.current = true;
        const context = [...transcriptRef.current.filter((turn) => !turn.isUncertain).map(({ speaker, text: turnText }) => ({ speaker, text: turnText })), { speaker: "Room", text: combinedText }].slice(-5);
        queueSpeculativePrediction(context, INTERIM_CAPTION_PREDICTION_DEBOUNCE_MS);
        recordDebugEvent("prediction_prefetched_interim", { text: combinedText });
      },
    );
    return () => liveTranscriber.current?.stop();
  }, [bufferPartnerTurn, conversationSettings.language, queueSpeculativePrediction, recordDebugEvent]);

  useEffect(() => {
    if (!isDemoPlaying || listenStatus === "listening") return;
    const interval = window.setInterval(() => {
      void conversationService.transcribe(lastTranscriptText.current).then(appendPartnerTurn);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [appendPartnerTurn, isDemoPlaying, listenStatus]);

  useEffect(() => {
    lastTranscriptText.current = transcript.at(-1)?.text;
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => () => {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    if (partnerTurnSettleTimer.current) window.clearTimeout(partnerTurnSettleTimer.current);
    inFlightRequest.current?.abort();
  }, []);

  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => { window.removeEventListener("online", updateNetworkState); window.removeEventListener("offline", updateNetworkState); };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      return;
    }
    void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))).catch(() => undefined);
  }, []);

  useEffect(() => {
    const nextTheme = preferredTheme();
    applyTheme(nextTheme);
    setTheme(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    window.localStorage.setItem(themeStorageKey, nextTheme);
    setTheme(nextTheme);
  };

  const playDemo = () => {
    liveTranscriber.current?.stop();
    const demoSuggestions = candidatesToSuggestions(offlinePredict({ transcript: initialTranscriptInput, profile: profileRef.current, memory: memoryRef.current, count: 4 }));
    commitTranscript(initialTranscript);
    setSpoken([]);
    setBaseSuggestions(demoSuggestions);
    setSuggestions(demoSuggestions);
    setSuggestionMode("reply");
    setPredictionStatus("ready");
    setIsDemoPlaying(true);
    setError("");
    lastPartnerTurnAt.current = Date.now();
    recordDebugEvent("demo_started");
    document.getElementById("replies")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const grantRealModeConsent = () => {
    window.localStorage.setItem("cadence.realModeConsent", "1");
    setHasRealModeConsent(true);
    setShowPrivacy(false);
  };

  const eraseLocalData = () => {
    conversationService.stopSpeaking();
    Object.keys(window.localStorage).filter((key) => key.startsWith("cadence.")).forEach((key) => window.localStorage.removeItem(key));
    window.location.reload();
  };

  const clearLocalSession = () => {
    window.localStorage.removeItem(localSessionKey);
    commitTranscript([]);
    setSpoken([]);
    setBaseSuggestions([]);
    setSuggestions([]);
    setSuggestionMode("reply");
    setPredictionStatus("ready");
    setIsDemoPlaying(false);
    setError("");
    recordDebugEvent("local_session_cleared");
  };

  const transcriptForModel = (): TranscriptInput[] => transcript.filter((turn) => !turn.isUncertain).map(({ speaker, text }) => ({ speaker, text }));

  const rejectTranscriptContext = useCallback((id: string) => {
    const originalTurn = transcriptRef.current.find((turn) => turn.id === id);
    if (!originalTurn) return;
    const updated = transcriptRef.current.map((turn) => turn.id === id ? { ...turn, isUncertain: true, confidence: 0 } : turn);
    const usableTurns = updated.filter((turn) => !turn.isUncertain).map(({ speaker, text }) => ({ speaker, text }));
    commitTranscript(updated);
    setContextUndo(originalTurn);
    setSelectedSuggestion(null);
    setError(usableTurns.length ? "That caption is not being used for these replies. Preparing a new set." : "That caption is not being used. Listen for another turn, fix the caption, or start something yourself.");
    recordDebugEvent("reply_context_rejected", { id });
    if (usableTurns.length) queueSpeculativePrediction(usableTurns, 0);
    else {
      setBaseSuggestions([]);
      setSuggestions([]);
      setPredictionStatus("ready");
    }
  }, [commitTranscript, queueSpeculativePrediction, recordDebugEvent]);

  const restoreTranscriptContext = useCallback(() => {
    if (!contextUndo) return;
    const updated = transcriptRef.current.map((turn) => turn.id === contextUndo.id ? contextUndo : turn);
    commitTranscript(updated);
    setContextUndo(null);
    setError("That caption is back in context. Preparing replies again.");
    queueSpeculativePrediction(updated.filter((turn) => !turn.isUncertain).map(({ speaker, text }) => ({ speaker, text })), 0);
    recordDebugEvent("reply_context_restored", { id: contextUndo.id });
  }, [commitTranscript, contextUndo, queueSpeculativePrediction, recordDebugEvent]);

  const confirmTranscriptTurn = useCallback((id: string, text: string) => {
    const updated = transcriptRef.current.map((turn) => turn.id === id ? { ...turn, text: text.trim(), isUncertain: false, confidence: 1 } : turn);
    commitTranscript(updated);
    queueSpeculativePrediction(updated.filter((item) => !item.isUncertain).map(({ speaker, text: turnText }) => ({ speaker, text: turnText })));
    recordDebugEvent("transcript_turn_confirmed", { id, text });
    setSelectedTranscriptTurn(null);
  }, [commitTranscript, queueSpeculativePrediction, recordDebugEvent]);

  const renameTranscriptSpeaker = useCallback((id: string, speaker: string) => {
    const cleanedSpeaker = speaker.trim().slice(0, 80);
    if (!cleanedSpeaker) return;
    const updated = transcriptRef.current.map((turn) => turn.id === id ? { ...turn, speaker: cleanedSpeaker } : turn);
    commitTranscript(updated);
    rememberTranscript(updated.map(({ speaker: turnSpeaker, text }) => ({ speaker: turnSpeaker, text })));
    queueSpeculativePrediction(updated.filter((item) => !item.isUncertain).map(({ speaker: turnSpeaker, text }) => ({ speaker: turnSpeaker, text })));
    recordDebugEvent("transcript_speaker_named", { id, speaker: cleanedSpeaker });
    setSpeakerTurn(null);
  }, [commitTranscript, queueSpeculativePrediction, recordDebugEvent, rememberTranscript]);

  const addSpoken = useCallback(async (text: string, delivery?: "needs", toneOverride: Tone = tone, source = "direct") => {
    if (speakingRef.current) return;
    const matchingSuggestion = source === "direct" ? suggestions.find((suggestion) => suggestion.text === text) : undefined;
    if (matchingSuggestion && replyPreferencesRef.current.previewBeforeSpeaking) {
      setSelectedSuggestion(matchingSuggestion);
      recordDebugEvent("reply_previewed", { text: matchingSuggestion.text, intent: matchingSuggestion.label });
      return;
    }
    setSpoken((current) => [{ id: crypto.randomUUID(), text, time: "now", impact: calculateReplyImpact(text) }, ...current]);
    const initiated = suggestionMode === "initiate" && source.includes("reply");
    setParticipationEvents((current) => [...current, { kind: "spoken", at: Date.now(), responseSeconds: Math.max(0, Math.round((Date.now() - lastPartnerTurnAt.current) / 1000)) }, ...(initiated ? [{ kind: "initiated" as const, at: Date.now() }] : [])]);
    recordDebugEvent("speech_selected", { text, tone: toneOverride, delivery, source });
    if (!window.localStorage.getItem("cadence.firstSpeechCelebrated")) {
      window.localStorage.setItem("cadence.firstSpeechCelebrated", "1");
      setShowFirstSpeechAffirmation(true);
    }
    try {
      speakingRef.current = true;
      setIsSpeaking(true);
      setSpeechStatus("preparing");
      const speechRequestedAt = performance.now();
      await conversationService.speak(text, toneOverride, delivery, ttsVoice, () => {
        setSpeechStatus("playing");
        recordDebugEvent("speech_playback_started", { text, source, output: speechOutput, audioStartedMs: Math.round(performance.now() - speechRequestedAt) });
      }, speechOutput === "device");
      recordDebugEvent("speech_completed", { text, tone: toneOverride, delivery, source });
    } catch (speakError) {
      if (isConsentRequired(speakError)) return;
      const message = speakError instanceof Error ? speakError.message : "Unable to speak this reply.";
      setError(message);
      recordDebugEvent("speech_failed", { text, message, source });
    } finally {
      speakingRef.current = false;
      setIsSpeaking(false);
      setSpeechStatus("idle");
    }
  }, [isConsentRequired, recordDebugEvent, speechOutput, suggestionMode, suggestions, tone, ttsVoice]);

  const saveConversationSettings = useCallback((nextSettings: ConversationSettings) => {
    const previousPrivateSession = conversationSettingsRef.current.privateSession;
    const cleaned = sanitizeConversationSettings(nextSettings);
    conversationSettingsRef.current = cleaned;
    window.localStorage.setItem("cadence.conversationSettings", JSON.stringify(cleaned));
    if (cleaned.privateSession) {
      window.localStorage.removeItem(localSessionKey);
      window.localStorage.removeItem("cadence.lastSuggestions");
    }
    setConversationSettings(cleaned);
    recordDebugEvent("conversation_settings_saved", { settings: cleaned });
    if (previousPrivateSession === cleaned.privateSession) refreshPredictions(transcript.map(({ speaker, text }) => ({ speaker, text })));
  }, [recordDebugEvent, refreshPredictions, transcript]);

  const persistConversationSettings = useCallback((nextSettings: ConversationSettings) => {
    const cleaned = sanitizeConversationSettings(nextSettings);
    conversationSettingsRef.current = cleaned;
    window.localStorage.setItem("cadence.conversationSettings", JSON.stringify(cleaned));
    if (cleaned.privateSession) {
      window.localStorage.removeItem(localSessionKey);
      window.localStorage.removeItem("cadence.lastSuggestions");
    }
    setConversationSettings(cleaned);
  }, []);

  const saveConversationKit = useCallback((name: string) => {
    const cleanedName = name.trim().slice(0, 40);
    if (!cleanedName) return;
    const nextKit: ConversationKit = { id: crypto.randomUUID(), name: cleanedName, settings: { ...conversationSettingsRef.current, privateSession: false }, voice: ttsVoice };
    const nextKits = sanitizeConversationKits([...conversationKits.filter((kit) => kit.name.localeCompare(cleanedName, undefined, { sensitivity: "accent" }) !== 0), nextKit]);
    window.localStorage.setItem(conversationKitsKey, JSON.stringify(nextKits));
    setConversationKits(nextKits);
    recordDebugEvent("conversation_kit_saved", { name: cleanedName });
  }, [conversationKits, recordDebugEvent, ttsVoice]);

  const deleteConversationKit = useCallback((id: string) => {
    const nextKits = conversationKits.filter((kit) => kit.id !== id);
    window.localStorage.setItem(conversationKitsKey, JSON.stringify(nextKits));
    setConversationKits(nextKits);
  }, [conversationKits]);

  const savePersonalVocabulary = useCallback((nextVocabulary: PersonalVocabularyEntry[]) => {
    const cleaned = sanitizePersonalVocabulary(nextVocabulary);
    personalVocabularyRef.current = cleaned;
    window.localStorage.setItem(personalVocabularyKey, JSON.stringify(cleaned));
    setPersonalVocabulary(cleaned);
    recordDebugEvent("personal_vocabulary_saved", { entries: cleaned.length });
  }, [recordDebugEvent]);

  const persistProfile = useCallback((nextProfile: PersonalProfile) => {
    profileRef.current = nextProfile;
    window.localStorage.setItem("cadence.profile", JSON.stringify(nextProfile));
    setProfile(nextProfile);
  }, []);

  const saveReplyPreferences = useCallback((nextPreferences: ReplyPreferences) => {
    replyPreferencesRef.current = nextPreferences;
    window.localStorage.setItem("cadence.replyPreferences", JSON.stringify(nextPreferences));
    setReplyPreferences(nextPreferences);
  }, []);

  const shortenSuggestion = useCallback(() => {
    setSelectedSuggestion((current) => current ? { ...current, text: current.text.split(/[.!?]/)[0].slice(0, 80).trim() || current.text } : current);
  }, []);

  const removeSelectedSuggestion = useCallback((reason: "not_me" | "never") => {
    if (!selectedSuggestion) return;
    if (reason === "never") {
      const nextPreferences = { ...replyPreferencesRef.current, blockedPhrases: [...replyPreferencesRef.current.blockedPhrases, selectedSuggestion.text] };
      saveReplyPreferences(sanitizeReplyPreferences(nextPreferences));
    }
    setSuggestions((current) => current.filter((suggestion) => suggestion.id !== selectedSuggestion.id));
    setBaseSuggestions((current) => current.filter((suggestion) => suggestion.id !== selectedSuggestion.id));
    recordDebugEvent("reply_rejected", { text: selectedSuggestion.text, reason });
    setParticipationEvents((current) => [...current, { kind: "rejected", at: Date.now() }]);
    setSelectedSuggestion(null);
  }, [recordDebugEvent, saveReplyPreferences, selectedSuggestion]);

  const toggleFavorite = useCallback(() => {
    if (!selectedSuggestion) return;
    const favorites = replyPreferencesRef.current.favorites;
    const isFavorite = favorites.includes(selectedSuggestion.text);
    const nextPreferences = { ...replyPreferencesRef.current, favorites: isFavorite ? favorites.filter((item) => item !== selectedSuggestion.text) : [...favorites, selectedSuggestion.text] };
    saveReplyPreferences(sanitizeReplyPreferences(nextPreferences));
    recordDebugEvent("reply_favorite_changed", { text: selectedSuggestion.text, favorite: !isFavorite });
  }, [recordDebugEvent, saveReplyPreferences, selectedSuggestion]);

  const stopSpeaking = useCallback(() => {
    conversationService.stopSpeaking();
    setSpeechStatus("idle");
    recordDebugEvent("speech_stopped");
  }, [recordDebugEvent]);

  const holdTheFloor = useCallback(() => {
    const phrase = floorHoldingPhrases[floorPhraseIndex.current % floorHoldingPhrases.length];
    floorPhraseIndex.current += 1;
    void addSpoken(phrase, undefined, undefined, "hold_floor");
  }, [addSpoken]);

  const speakNeed = useCallback((text: string) => addSpoken(text, "needs", undefined, "need"), [addSpoken]);

  const speakFeeling = useCallback((text: string) => addSpoken(text, undefined, "warm", "feeling"), [addSpoken]);

  const speakRepair = useCallback((text: string) => addSpoken(text, undefined, "firm", "repair"), [addSpoken]);

  const saveNeeds = useCallback((nextNeeds: string[]) => {
    const cleaned = sanitizeNeeds(nextNeeds);
    window.localStorage.setItem("cadence.needs", JSON.stringify(cleaned));
    setNeeds(cleaned);
    recordDebugEvent("needs_saved", { needs: cleaned });
  }, [recordDebugEvent]);

  const saveFeelings = useCallback((nextFeelings: string[]) => {
    const cleaned = sanitizeFeelings(nextFeelings);
    window.localStorage.setItem("cadence.feelings", JSON.stringify(cleaned));
    setFeelings(cleaned);
    recordDebugEvent("feelings_saved", { feelings: cleaned });
  }, [recordDebugEvent]);

  const saveRepairPhrases = useCallback((nextPhrases: string[]) => {
    const cleaned = sanitizeRepairPhrases(nextPhrases);
    window.localStorage.setItem(repairPhrasesKey, JSON.stringify(cleaned));
    setRepairPhrases(cleaned);
    recordDebugEvent("repair_phrases_saved", { phrases: cleaned });
  }, [recordDebugEvent]);

  const saveHelpPlan = useCallback((nextPlan: HelpPlan) => {
    const cleaned = sanitizeHelpPlan(nextPlan);
    window.localStorage.setItem(helpPlanKey, JSON.stringify(cleaned));
    setHelpPlan(cleaned);
    recordDebugEvent("help_plan_saved", { hasInstruction: Boolean(cleaned.instruction) });
  }, [recordDebugEvent]);

  const selectTtsVoice = (nextVoice: TtsVoice) => {
    window.localStorage.setItem("cadence.ttsVoice", nextVoice);
    setTtsVoice(nextVoice);
    setShowVoicePicker(false);
    recordDebugEvent("tts_voice_changed", { voice: nextVoice });
  };

  const selectSpeechOutput = (nextOutput: SpeechOutput) => {
    window.localStorage.setItem("cadence.speechOutput", nextOutput);
    setSpeechOutput(nextOutput);
    recordDebugEvent("speech_output_changed", { output: nextOutput });
  };

  const previewTtsVoice = async (voice: TtsVoice) => {
    setIsPreviewingVoice(true);
    try {
      await conversationService.speak("Hello. This is how I sound in Cadence.", tone, undefined, voice, undefined, speechOutput === "device");
    } catch (previewError) {
      if (!isConsentRequired(previewError)) setError(previewError instanceof Error ? previewError.message : "Unable to preview this voice.");
    } finally {
      setIsPreviewingVoice(false);
    }
  };

  const scanTargets = useMemo(() => [
    ...suggestions.map((suggestion) => ({ id: `suggestion-${suggestion.id}`, label: `${suggestion.label} reply: ${suggestion.text}`, select: () => void addSpoken(suggestion.text, undefined, undefined, "scan_suggestion") })),
    ...quickReplies.map((reply) => ({ id: `reaction-${reply}`, label: `Quick reaction: ${reply}`, select: () => void addSpoken(reply) })),
    ...feelings.map((feeling, index) => ({ id: `feeling-${index}`, label: `Feeling: ${feeling}`, select: () => speakFeeling(feeling) })),
    ...(showNeeds ? needs.map((need, index) => ({ id: `need-${index}`, label: `My need: ${need}`, select: () => speakNeed(need) })) : [{ id: "open-needs", label: "Open My needs", select: () => setShowNeeds(true) }]),
    { id: "backup-board", label: "Open offline backup board", select: () => setShowBackupBoard(true) },
    { id: "hold-floor", label: "Hold the floor", select: holdTheFloor },
  ], [addSpoken, feelings, holdTheFloor, needs, showNeeds, speakFeeling, speakNeed, suggestions]);
  const highlightedTargetId = isEyeGazeActive ? (gazeTargetIndex === null ? undefined : scanTargets[gazeTargetIndex]?.id) : isScanningMode ? scanTargets[scanIndex]?.id : undefined;
  const estimatedGazePoint = useMemo(() => {
    if (!isEyeGazeActive || !eyeGazeSettings.calibration || !eyeGazeFeature || eyeGazeFeature.confidence < 0.25) return null;
    return estimateGazePoint(eyeGazeFeature, eyeGazeSettings.calibration);
  }, [eyeGazeFeature, eyeGazeSettings.calibration, isEyeGazeActive]);
  const activeGazeTarget = isEyeGazeActive && gazeTargetIndex !== null ? scanTargets[gazeTargetIndex] : null;
  const gazeCandidateTarget = isEyeGazeActive && gazeCandidateIndex !== null ? scanTargets[gazeCandidateIndex] : null;

  const saveEyeGazeSettings = useCallback((nextSettings: EyeGazeSettings) => {
    const cleaned = sanitizeEyeGazeSettings(nextSettings);
    window.localStorage.setItem(eyeGazeSettingsKey, JSON.stringify(cleaned));
    setEyeGazeSettings(cleaned);
    recordDebugEvent("eye_gaze_settings_saved", { calibrated: Boolean(cleaned.calibration), consented: cleaned.consented });
  }, [recordDebugEvent]);

  useEffect(() => {
    if (!estimatedGazePoint) {
      gazeTargetCandidateRef.current = null;
      setGazeCandidateIndex(null);
      setGazeCursorPoint(null);
      setGazeTargetIndex(null);
      return;
    }
    const point = estimatedGazePoint;
    setGazeCursorPoint({ x: point.x, y: point.y });
    const pointX = point.x * window.innerWidth;
    const pointY = point.y * window.innerHeight;
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestCenter: { x: number; y: number } | null = null;
    scanTargets.forEach((target, index) => {
      const element = document.querySelector<HTMLElement>(`[data-cadence-gaze-id="${target.id}"]`);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
      const horizontal = Math.max(rect.left - pointX, 0, pointX - rect.right) / window.innerWidth;
      const vertical = Math.max(rect.top - pointY, 0, pointY - rect.bottom) / window.innerHeight;
      const distance = Math.hypot(horizontal, vertical);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
        closestCenter = { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight };
      }
    });
    const rawCursorPoint = { x: point.x, y: point.y };
    const aimAssistRadius = 0.2;
    const focusRadius = 0.14;
    if (closestIndex < 0 || !closestCenter) {
      setGazeCursorPoint(rawCursorPoint);
      gazeTargetCandidateRef.current = null;
      setGazeCandidateIndex(null);
      setGazeTargetIndex(null);
      return;
    }
    const targetCenter = closestCenter as { x: number; y: number };
    const proximity = Math.max(0, 1 - closestDistance / aimAssistRadius);
    const pull = proximity * 0.62;
    setGazeCursorPoint({
      x: rawCursorPoint.x + (targetCenter.x - rawCursorPoint.x) * pull,
      y: rawCursorPoint.y + (targetCenter.y - rawCursorPoint.y) * pull,
    });
    if (closestDistance > focusRadius) {
      gazeTargetCandidateRef.current = null;
      setGazeCandidateIndex(null);
      setGazeTargetIndex(null);
      return;
    }
    const target = scanTargets[closestIndex];
    const now = Date.now();
    if (gazeTargetCandidateRef.current?.id !== target.id) {
      gazeTargetCandidateRef.current = { id: target.id, startedAt: now };
      setGazeCandidateIndex(closestIndex);

      setGazeTargetIndex(null);
      return;
    }
    if (now - gazeTargetCandidateRef.current.startedAt >= 350) setGazeTargetIndex((current) => current === closestIndex ? current : closestIndex);
  }, [estimatedGazePoint, scanTargets]);

  const selectScannedTarget = useCallback(() => {
    const targetIndex = isEyeGazeActive ? gazeTargetIndex : scanIndex;
    if (targetIndex === null) return;
    const target = scanTargets[targetIndex];
    if (!target) return;
    recordDebugEvent("scan_target_selected", { id: target.id, label: target.label });
    target.select();
    setScanIndex(0);
    setGazeTargetIndex(null);
  }, [gazeTargetIndex, isEyeGazeActive, recordDebugEvent, scanIndex, scanTargets]);

  const toggleScanningMode = () => {
    if (isScanningMode) {
      setIsScanningMode(false);
      recordDebugEvent("scanning_changed", { enabled: false });
      return;
    }
    setScanIndex(0);
    setIsScanningMode(true);
    recordDebugEvent("scanning_changed", { enabled: true });
  };

  useEffect(() => {
    if (!isScanningMode || !scanTargets.length) return;
    const scanInterval = conversationSettings.energy === "low" ? 1800 : conversationSettings.scanIntervalMs || SCAN_INTERVAL_MS;
    const interval = window.setInterval(() => setScanIndex((current) => (current + 1) % scanTargets.length), scanInterval);
    return () => window.clearInterval(interval);
  }, [conversationSettings.energy, conversationSettings.scanIntervalMs, isScanningMode, scanTargets.length]);

  useEffect(() => {
    if (!isScanningMode && !isEyeGazeActive) return;
    const selectWithSingleSwitch = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      selectScannedTarget();
    };
    window.addEventListener("keydown", selectWithSingleSwitch);
    return () => window.removeEventListener("keydown", selectWithSingleSwitch);
  }, [isEyeGazeActive, isScanningMode, selectScannedTarget]);

  const handleCustomSpeak = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = customMessage.trim();
    if (!message) return;
    setCustomMessage("");
    void addSpoken(message, undefined, undefined, "custom_message");
  };

  const toggleListening = () => {
    if (!isOnline) {
      setError("Listening is paused while offline. Your reply cards, quick phrases, and device speech are still available.");
      return;
    }
    const controller = liveTranscriber.current;
    if (!controller?.supported) {
      setListenStatus("unsupported");
      setError("Live transcription is not supported in this browser. Try Chrome or Edge, or keep using the mock captions.");
      return;
    }
    setError("");
    if (listenStatus === "listening") {
      recordDebugEvent("listening_changed", { enabled: false });
      controller.stop();
      setListeningFeedback("");
    } else {
      recordDebugEvent("listening_changed", { enabled: true });
      controller.start();
      setListeningFeedback("Listening for the room…");
    }
  };

  const selectTone = async (nextTone: Tone) => {
    setTone(nextTone);
    window.localStorage.setItem("cadence.tone", nextTone);
    recordDebugEvent("tone_changed", { tone: nextTone });
    if (!baseSuggestions.length) return;
    if (!isOnline) {
      const adjusted = baseSuggestions.map((suggestion) => ({ ...suggestion, text: offlineToneAdjust(suggestion.text, nextTone) }));
      setSuggestions(adjusted);
      setError("Tone updated locally. Live refinements will resume when you reconnect.");
      return;
    }
    setIsRefreshing(true);
    setError("");
    try {
      const adjusted = await Promise.all(baseSuggestions.map(async (suggestion) => ({ ...suggestion, text: (await conversationService.toneAdjust({ text: suggestion.text, tone: nextTone })).text })));
      setSuggestions(adjusted);
      recordDebugEvent("tone_adjustment_completed", { tone: nextTone, suggestions: adjusted });
    } catch (toneError) {
      if (isConsentRequired(toneError)) return;
      if (shouldUseLocalFallback(toneError)) {
        const adjusted = baseSuggestions.map((suggestion) => ({ ...suggestion, text: offlineToneAdjust(suggestion.text, nextTone) }));
        setSuggestions(adjusted);
        setError("Live tone changes are unavailable. Tone updated locally instead.");
        recordDebugEvent("tone_adjustment_recovered_offline", { tone: nextTone });
        return;
      }
      const message = toneError instanceof Error ? toneError.message : "Unable to adjust the tone.";
      setError(message);
      recordDebugEvent("tone_adjustment_failed", { tone: nextTone, message });
    } finally {
      setIsRefreshing(false);
    }
  };

  const expandKeyword = async (rawKeyword: string) => {
    const steerKeyword = rawKeyword.trim();
    if (!steerKeyword) return;
    recordDebugEvent("keyword_submitted", { keyword: steerKeyword });
    setIsExpanding(true);
    setError("");
    if (!isOnline) {
      const variants = offlineExpand(steerKeyword, transcriptForModel(), profile);
      const expanded = candidatesToSuggestions(variants.map((text): Candidate => ({ text, intent: "other" })));
      setBaseSuggestions(expanded);
      setSuggestions(expanded);
      setSuggestionMode("reply");
      setKeyword("");
      setPredictionStatus("ready");
      setError("Replies were made locally. Live AI will resume when you reconnect.");
      setIsExpanding(false);
      recordDebugEvent("offline_keyword_expansion_completed", { keyword, variants });
      return;
    }
    try {
      const { variants } = await conversationService.expand({ keyword: steerKeyword, transcript: transcriptForModel(), styleCard: styleCardRef.current, profile });
      const expanded = candidatesToSuggestions(variants.map((text): Candidate => ({ text, intent: "other" })));
      setBaseSuggestions(expanded);
      setSuggestions(expanded);
      setSuggestionMode("reply");
      setKeyword("");
      setPredictionStatus("ready");
      recordDebugEvent("keyword_expansion_completed", { keyword: steerKeyword, variants });
    } catch (expandError) {
      if (isConsentRequired(expandError)) return;
      if (shouldUseLocalFallback(expandError)) {
        const variants = offlineExpand(steerKeyword, transcriptForModel(), profile);
        const expanded = candidatesToSuggestions(variants.map((text): Candidate => ({ text, intent: "other" })));
        setBaseSuggestions(expanded);
        setSuggestions(expanded);
        setSuggestionMode("reply");
        setKeyword("");
        setPredictionStatus("ready");
        setError("Live replies are unavailable. Made replies locally instead.");
        recordDebugEvent("keyword_expansion_recovered_offline", { keyword: steerKeyword });
        return;
      }
      const message = expandError instanceof Error ? expandError.message : "Unable to create replies.";
      setError(message);
      recordDebugEvent("keyword_expansion_failed", { keyword, message });
    } finally {
      setIsExpanding(false);
    }
  };

  const handleExpand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void expandKeyword(keyword);
  };

  const resumeRoomListening = () => {
    setIsVoiceSteering(false);
    if (!resumeRoomListeningAfterSteer.current) return;
    resumeRoomListeningAfterSteer.current = false;
    window.setTimeout(() => liveTranscriber.current?.start(), 100);
  };

  const startVoiceSteer = () => {
    if (isVoiceSteering) {
      voiceSteerTranscriber.current?.stop();
      resumeRoomListening();
      return;
    }
    resumeRoomListeningAfterSteer.current = listenStatus === "listening";
    if (resumeRoomListeningAfterSteer.current) liveTranscriber.current?.stop();
    const controller = transcribeOnce((text) => {
      setKeyword(text);
      recordDebugEvent("voice_steer_received", { text });
      resumeRoomListening();
      void expandKeyword(text);
    }, (message) => {
      resumeRoomListening();
      setError(message);
      recordDebugEvent("voice_steer_failed", { message });
    });
    voiceSteerTranscriber.current = controller;
    if (!controller.supported) {
      setError("Voice input is not supported in this browser. Type a short idea instead.");
      return;
    }
    setIsVoiceSteering(true);
    setError("");
    controller.start();
  };

  const startSomething = async (steerKeyword = keyword) => {
    setIsInitiating(true);
    setError("");
    recordDebugEvent("initiation_requested", { keyword: steerKeyword?.trim() || undefined, transcript: transcriptForModel() });
    const activeMemory = conversationSettingsRef.current.privateSession ? emptyConversationMemory : memoryRef.current;
    if (!isOnline) {
      const candidates = offlineInitiate({ transcript: transcriptForModel(), profile, memory: activeMemory, keyword: steerKeyword?.trim() || undefined, count: conversationSettingsRef.current.energy === "low" ? 2 : 4 });
      const starters = candidatesToSuggestions(candidates);
      setBaseSuggestions(starters);
      setSuggestions(starters);
      setSuggestionMode("initiate");
      setPredictionStatus("ready");
      if (steerKeyword?.trim()) setKeyword("");
      setError("Conversation starters are ready locally. Live AI will resume when you reconnect.");
      setIsInitiating(false);
      recordDebugEvent("offline_initiation_completed", { candidates });
      return;
    }
    try {
      const { candidates } = await conversationService.initiate({ transcript: transcriptForModel(), styleCard: styleCardRef.current, profile, memory: activeMemory, settings: conversationSettingsRef.current, keyword: steerKeyword?.trim() || undefined, n: conversationSettingsRef.current.energy === "low" ? 2 : 4 });
      const starters = candidatesToSuggestions(candidates);
      setBaseSuggestions(starters);
      setSuggestions(starters);
      setSuggestionMode("initiate");
      setPredictionStatus("ready");
      if (steerKeyword?.trim()) setKeyword("");
      recordDebugEvent("initiation_completed", { candidates });
    } catch (initiateError) {
      if (isConsentRequired(initiateError)) return;
      if (shouldUseLocalFallback(initiateError)) {
        const candidates = offlineInitiate({ transcript: transcriptForModel(), profile, memory: activeMemory, keyword: steerKeyword?.trim() || undefined, count: conversationSettingsRef.current.energy === "low" ? 2 : 4 });
        const starters = candidatesToSuggestions(candidates);
        setBaseSuggestions(starters);
        setSuggestions(starters);
        setSuggestionMode("initiate");
        setPredictionStatus("ready");
        if (steerKeyword?.trim()) setKeyword("");
        setError("Live starters are unavailable. Made conversation starters locally instead.");
        recordDebugEvent("initiation_recovered_offline", { reason: initiateError instanceof Error ? initiateError.name : "network" });
        return;
      }
      const message = initiateError instanceof Error ? initiateError.message : "Unable to prepare conversation starters.";
      setError(message);
      recordDebugEvent("initiation_failed", { message });
    } finally {
      setIsInitiating(false);
    }
  };

  const setDebugRecording = (enabled: boolean) => {
    if (enabled && conversationSettingsRef.current.privateSession) {
      setError("Debug recording is unavailable during a private session.");
      return;
    }
    debugEnabledRef.current = enabled;
    window.localStorage.setItem(debugEnabledKey, enabled ? "1" : "0");
    setDebugRecordingEnabled(enabled);
    if (enabled) {
      const nextEvents = appendDebugEvent(debugEventsRef.current, "recording_started", { note: "Local-only diagnostic recording enabled by the user." });
      debugEventsRef.current = nextEvents;
      window.localStorage.setItem(debugLogKey, JSON.stringify(nextEvents));
      setDebugEvents(nextEvents);
    }
  };

  const clearDebugEvents = () => {
    debugEventsRef.current = [];
    window.localStorage.removeItem(debugLogKey);
    setDebugEvents([]);
  };

  const exportDebugEvents = () => {
    const blob = new Blob([JSON.stringify(debugEventsRef.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cadence-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    recordDebugEvent("recording_exported", { eventCount: debugEventsRef.current.length });
  };

  const sessionImpact = calculateSessionImpact(spoken.map((item) => item.text));
  const participationSummary = summarizeParticipation(participationEvents);

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-3 py-3 pb-24 text-[#122726] sm:px-6 sm:py-6 sm:pb-28 lg:px-10 lg:py-8">
      <a href="#replies" className="skip-link">Skip to reply cards</a>
      <EyeGazeController key={eyeGazeRunId} active={eyeGazeCameraRequested} speed={eyeGazeSettings.speed} onFeature={handleEyeGazeFeature} onStatus={handleEyeGazeStatus} />
      {isEyeGazeActive && gazeCursorPoint && <div className="gaze-cursor" style={{ left: `${gazeCursorPoint.x * 100}%`, top: `${gazeCursorPoint.y * 100}%` }} aria-hidden="true"><span /></div>}
      {(isScanningMode || isEyeGazeActive) && <p className="sr-only" aria-live="assertive" aria-atomic="true">{isEyeGazeActive ? `Eye-gaze focus: ${activeGazeTarget?.label ?? gazeCandidateTarget?.label ?? "move toward a visible choice"}. Press Space or Enter to select.` : `Scanning ${scanTargets[scanIndex]?.label}. Target ${scanIndex + 1} of ${scanTargets.length}. Press Space or Enter to select.`}</p>}
      {(isScanningMode || isEyeGazeActive) && <div className="fixed bottom-20 left-3 z-40 sm:bottom-4 sm:left-4"><button type="button" onClick={selectScannedTarget} disabled={isEyeGazeActive && gazeTargetIndex === null} className="min-h-14 rounded-2xl bg-[#f7d341] px-5 text-base font-black text-[#102823] shadow-xl ring-4 ring-[#102823] ring-offset-2 ring-offset-[#f5f7f4] transition hover:bg-[#ffe36b] focus:outline-none focus:ring-4 focus:ring-[#102823] disabled:cursor-not-allowed disabled:opacity-55">{isEyeGazeActive && gazeTargetIndex === null ? "Look at a choice" : "Select highlighted"}</button></div>}
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-2 sm:bottom-4 sm:left-4"><button type="button" data-cadence-gaze-id="open-needs" onClick={() => { recordDebugEvent("needs_opened"); setShowNeeds(true); }} aria-haspopup="dialog" className={`min-h-12 rounded-full bg-[#305a4e] px-4 text-sm font-bold text-white shadow-xl transition hover:bg-[#23493e] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14 sm:px-5 sm:text-base ${highlightedTargetId === "open-needs" ? "scale-105 bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4]" : ""}`}>My needs</button>{transcript.at(-1)?.isUncertain && <button type="button" onClick={() => setSelectedTranscriptTurn(transcript.at(-1) ?? null)} aria-label="Review uncertain caption" className="min-h-12 rounded-full bg-[#f7d341] px-3 text-sm font-black text-[#102823] shadow-lg focus:outline-none focus:ring-4 focus:ring-[#173d3a] sm:min-h-14">Fix caption</button>}<button type="button" data-cadence-gaze-id="backup-board" onClick={() => setShowBackupBoard(true)} aria-haspopup="dialog" aria-label="Open offline backup board" className="grid min-h-12 min-w-12 place-items-center rounded-full border border-[#b9d4c5] bg-white px-3 text-sm font-black text-[#305a4e] shadow-lg hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14">▦</button></div>
      <div className="fixed bottom-3 right-3 z-40 flex items-center gap-2" aria-live="polite">{isSpeaking && <><span className="hidden rounded-full bg-[#102823] px-3 py-2 text-xs font-bold text-white shadow-lg sm:inline">{speechStatus === "preparing" ? "Getting voice ready…" : "Speaking…"}</span><button type="button" onClick={stopSpeaking} aria-label="Stop speaking audio" className="min-h-12 rounded-full border border-[#b9cfc2] bg-white px-3 text-sm font-bold text-[#315a4b] shadow-lg hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14">Stop</button></>}<button type="button" data-cadence-gaze-id="hold-floor" onClick={holdTheFloor} aria-label="Hold the floor and speak a response placeholder" disabled={isSpeaking} className={`min-h-12 rounded-full bg-[#1f7a57] px-4 text-sm font-bold text-white shadow-xl transition hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:cursor-wait disabled:opacity-70 sm:min-h-14 sm:px-5 sm:text-base ${highlightedTargetId === "hold-floor" ? "scale-105 bg-[#f7d341] text-[#102823] ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4]" : ""}`}>{isSpeaking ? "Speaking…" : "Hold the floor"}</button></div>
      {showOnboarding && <Onboarding onStart={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); }} onTour={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setTutorialStep(0); }} onSetupVoice={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowVoiceSetup(true); }} onSetupProfile={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowProfileSetup(true); }} onSetupAccess={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowEyeGazeSetup(true); }} />}
      {showFirstSpeechAffirmation && <FirstSpeechAffirmation onDismiss={() => setShowFirstSpeechAffirmation(false)} />}
      {showVoiceSetup && <VoiceSetup initialStyleCard={styleCard} hasLearnedStyle={hasLearnedStyle} onClose={() => setShowVoiceSetup(false)} onSave={(nextStyleCard) => { styleCardRef.current = nextStyleCard; window.localStorage.setItem("cadence.styleCard", nextStyleCard); setStyleCard(nextStyleCard); setHasLearnedStyle(true); recordDebugEvent("voice_style_saved", { styleCard: nextStyleCard }); }} />}
      {showProfileSetup && <ProfileSetup initialProfile={profile} onClose={() => setShowProfileSetup(false)} onChange={persistProfile} onSave={(nextProfile) => { persistProfile(nextProfile); setShowProfileSetup(false); recordDebugEvent("personal_details_saved", { profile: nextProfile }); refreshPredictions(transcriptForModel()); }} />}
      {showConversationSetup && <ConversationSetup initialSettings={conversationSettings} onClose={() => setShowConversationSetup(false)} onChange={persistConversationSettings} onSave={(settings) => { saveConversationSettings(settings); setShowConversationSetup(false); }} />}
      {showConversationKits && <ConversationKitsDialog kits={conversationKits} settings={conversationSettings} onApply={(kit) => { saveConversationSettings({ ...kit.settings, privateSession: false }); if (kit.voice) selectTtsVoice(kit.voice); setShowConversationKits(false); }} onClose={() => setShowConversationKits(false)} onDelete={deleteConversationKit} onSave={saveConversationKit} />}
      {showVocabulary && <PersonalVocabularyDialog vocabulary={personalVocabulary} userName={profile.preferredName} onClose={() => setShowVocabulary(false)} onSave={savePersonalVocabulary} />}
      {showEyeGazeSetup && <EyeGazeSetupDialog settings={eyeGazeSettings} status={eyeGazeStatus} statusMessage={eyeGazeMessage} feature={eyeGazeFeature} active={isEyeGazeActive} onClose={() => { setShowEyeGazeSetup(false); if (!isEyeGazeActive) setEyeGazeCameraRequested(false); }} onStartCamera={() => { startEyeGazeCamera(); if (eyeGazeSettings.calibration) setIsEyeGazeActive(true); }} onSettingsChange={saveEyeGazeSettings} onSave={(settings) => { saveEyeGazeSettings(settings); setIsEyeGazeActive(true); startEyeGazeCamera(); setShowEyeGazeSetup(false); }} onTurnOff={() => { setIsEyeGazeActive(false); setEyeGazeCameraRequested(false); setEyeGazeFeature(null); setScanIndex(0); recordDebugEvent("eye_gaze_disabled"); }} />}
      {showPrivacy && <PrivacyDialog hasRealModeConsent={hasRealModeConsent} onClose={() => setShowPrivacy(false)} onConsent={grantRealModeConsent} onErase={eraseLocalData} />}
      {showVoicePicker && <VoicePicker selectedVoice={ttsVoice} isPreviewing={isPreviewingVoice} onClose={() => setShowVoicePicker(false)} onPreview={previewTtsVoice} onSelect={selectTtsVoice} />}
      {showMemory && <MemoryDialog memory={memory} onClose={() => setShowMemory(false)} onClear={() => { memoryRef.current = emptyConversationMemory; window.localStorage.setItem("cadence.memory", JSON.stringify(emptyConversationMemory)); setMemory(emptyConversationMemory); }} />}
      {showBackupBoard && <BackupBoardDialog needs={needs} feelings={feelings} favorites={replyPreferences.favorites} profile={profile} onClose={() => setShowBackupBoard(false)} onSpeak={(text) => void addSpoken(text, undefined, undefined, "backup_board")} />}
      {selectedTranscriptTurn && <TranscriptRepairDialog turn={selectedTranscriptTurn} onClose={() => setSelectedTranscriptTurn(null)} onConfirm={confirmTranscriptTurn} />}
      {speakerTurn && <SpeakerNameDialog turn={speakerTurn} suggestions={Array.from(new Set([...conversationSettings.peopleHere, ...memory.people, ...personalVocabulary.map((entry) => entry.writeAs)]))} onClose={() => setSpeakerTurn(null)} onSave={renameTranscriptSpeaker} />}
      {showNeeds && <NeedsDialog needs={needs} onClose={() => setShowNeeds(false)} onSpeak={speakNeed} onSave={saveNeeds} onOpenHelpPlan={() => { setShowNeeds(false); setShowHelpPlan(true); }} />}
      {showFeelings && <FeelingsDialog feelings={feelings} onClose={() => setShowFeelings(false)} onSpeak={speakFeeling} onSave={saveFeelings} />}
      {showRepairs && <RepairPhrasesDialog phrases={repairPhrases} onClose={() => setShowRepairs(false)} onSpeak={speakRepair} onSave={saveRepairPhrases} />}
      {showHelpPlan && <HelpPlanDialog plan={helpPlan} onClose={() => setShowHelpPlan(false)} onSave={saveHelpPlan} />}
      {selectedSuggestion && <ReplyPreviewDialog
        suggestion={selectedSuggestion}
        isFavorite={replyPreferences.favorites.includes(selectedSuggestion.text)}
        previewEnabled={replyPreferences.previewBeforeSpeaking}
        basedOn={suggestionMode === "reply" ? [...transcript].reverse().find((turn) => !turn.isUncertain) ?? null : null}
        onClose={() => setSelectedSuggestion(null)}
        onChange={(text) => { setSelectedSuggestion((current) => current ? { ...current, text } : current); setParticipationEvents((current) => [...current, { kind: "edited", at: Date.now() }]); }}
        onSpeak={() => { void addSpoken(selectedSuggestion.text, undefined, undefined, "reply_preview"); setSelectedSuggestion(null); }}
        onShorten={shortenSuggestion}
        onMoreLikeMe={() => { recordDebugEvent("reply_feedback", { text: selectedSuggestion.text, feedback: "more_like_me" }); replyFeedbackRef.current = "more_like_me"; setSelectedSuggestion(null); refreshPredictions(transcriptForModel()); }}
        onPreviewChange={(previewBeforeSpeaking) => saveReplyPreferences({ ...replyPreferencesRef.current, previewBeforeSpeaking })}
        onReject={removeSelectedSuggestion}
        onFavorite={toggleFavorite}
        onWrongContext={rejectTranscriptContext}
      />}
      {showDebugLog && <DebugLogDialog enabled={debugRecordingEnabled} events={debugEvents} onClose={() => setShowDebugLog(false)} onEnabledChange={setDebugRecording} onClear={clearDebugEvents} onExport={exportDebugEvents} />}
      {tutorialStep !== null && <TutorialDialog step={tutorialStep} onClose={() => setTutorialStep(null)} onStepChange={setTutorialStep} />}
      {showAbout && <AboutDialog isOnline={isOnline} listenStatus={listenStatus} hasRealModeConsent={hasRealModeConsent} onClose={() => setShowAbout(false)} onTour={() => { setShowAbout(false); setTutorialStep(0); }} />}
      {showPartnerGuide && <PartnerGuideDialog onClose={() => setShowPartnerGuide(false)} />}

      <div className="mx-auto max-w-[1440px]">
        <header className="relative flex items-center justify-between gap-2 border-b border-[#dbe5de] pb-3 sm:gap-3 sm:pb-4">
          <Link href="/" aria-label="Cadence home" className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173d3a] text-base font-bold text-white sm:h-11 sm:w-11 sm:rounded-2xl sm:text-lg" aria-hidden="true">C</div><div className="min-w-0"><p className="text-lg font-bold tracking-tight sm:text-xl">Cadence</p><p className="truncate text-xs font-medium text-[#60766e] sm:text-sm">{isDemoPlaying ? "Dinner at Maya's" : "Live conversation"} <span className="mx-1 text-[#a9bbb1]">/</span> {isDemoPlaying ? "Demo" : "Ready"}</p></div></Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={toggleListening} aria-pressed={listenStatus === "listening"} aria-label={listenStatus === "listening" ? "Turn listening off" : "Turn listening on"} className={`listen-toggle flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-bold shadow-sm transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14 sm:gap-2 sm:px-5 sm:text-base ${listenStatus === "listening" ? "listen-toggle-on" : "listen-toggle-off"}`}><span className={`listen-indicator h-3 w-3 rounded-full ${listenStatus === "listening" ? "animate-pulse" : ""}`} />{listenStatus === "listening" ? "Listening" : listenStatus === "unsupported" ? "Listen unavailable" : "Listen"}</button>
            <button type="button" onClick={() => setShowEyeGazeSetup(true)} aria-pressed={isEyeGazeActive} aria-label={isEyeGazeActive ? "Eye-gaze focus is on. Open controls." : "Set up eye-gaze focus"} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-lg font-bold transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:h-14 sm:w-14 ${isEyeGazeActive ? "border-[#1f7a57] bg-[#e3f4eb] text-[#176746]" : "border-[#cdd9d2] bg-white text-[#315a4b] hover:bg-[#edf5ef]"}`}><span aria-hidden="true">{"\u25CE"}</span><span className="sr-only">{isEyeGazeActive ? "Gaze on" : "Eye gaze"}</span></button>
            <div ref={moreMenuRef} className="relative">
              <button type="button" onClick={() => setShowMore((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") setShowMore(false); }} aria-expanded={showMore} aria-controls="more-menu" aria-label="Open Cadence settings and help" className="grid h-12 w-12 place-items-center rounded-full border border-[#cdd9d2] bg-white text-[#315a4b] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:h-14 sm:w-14"><span className="grid gap-1" aria-hidden="true"><span className="block h-0.5 w-5 rounded-full bg-current" /><span className="block h-0.5 w-5 rounded-full bg-current" /><span className="block h-0.5 w-5 rounded-full bg-current" /></span></button>
              {showMore && <div id="more-menu" aria-label="Cadence settings" className="more-menu absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[#d6e1da] bg-white p-2 shadow-xl">
                <details className="more-menu-section" onToggle={(event) => { if (!event.currentTarget.open) return; document.querySelectorAll<HTMLDetailsElement>("#more-menu details[open]").forEach((section) => { if (section !== event.currentTarget) section.open = false; }); }} open>
                  <summary>Access &amp; speech</summary>
                  <div className="more-menu-actions">
                    <button type="button" onClick={() => { toggleScanningMode(); setShowMore(false); }} aria-label={isScanningMode ? "Turn scanning off" : "Scanning mode"}>{isScanningMode ? "Turn scanning off" : "Scanning mode"}<span>Use one switch, Space, or Enter.</span></button>
                    <button type="button" onClick={() => { setShowVoicePicker(true); setShowMore(false); }}>Voice: {ttsVoice}<span>Choose an OpenAI speaking voice.</span></button>
                    <button type="button" onClick={() => { selectSpeechOutput(speechOutput === "device" ? "openai" : "device"); setShowMore(false); }}>{speechOutput === "device" ? "Use OpenAI voice" : "Use instant device voice"}<span>{speechOutput === "device" ? "Higher-quality cloud speech." : "Fast local speech when needed."}</span></button>
                  </div>
                </details>
                <details className="more-menu-section" onToggle={(event) => { if (!event.currentTarget.open) return; document.querySelectorAll<HTMLDetailsElement>("#more-menu details[open]").forEach((section) => { if (section !== event.currentTarget) section.open = false; }); }}>
                  <summary>Personalize Cadence</summary>
                  <div className="more-menu-actions">
                    <button type="button" onClick={() => { setShowVoiceSetup(true); setShowMore(false); }}>Your voice<span>Teach Cadence how you sound.</span></button>
                    <button type="button" onClick={() => { setShowProfileSetup(true); setShowMore(false); }}>Personal details<span>Add only the context you want.</span></button>
                    <button type="button" onClick={() => { setShowVocabulary(true); setShowMore(false); }}>Words to recognize<span>Names and words that matter to you.</span></button>
                    <button type="button" onClick={() => { setShowConversationKits(true); setShowMore(false); }}>Conversation kits<span>Save phrases for familiar situations.</span></button>
                    <button type="button" onClick={() => { setShowConversationSetup(true); setShowMore(false); }}>Conversation setup<span>Set context, energy, and scan speed.</span></button>
                  </div>
                </details>
                <details className="more-menu-section" onToggle={(event) => { if (!event.currentTarget.open) return; document.querySelectorAll<HTMLDetailsElement>("#more-menu details[open]").forEach((section) => { if (section !== event.currentTarget) section.open = false; }); }}>
                  <summary>Privacy &amp; session</summary>
                  <div className="more-menu-actions">
                    <button type="button" onClick={() => { saveConversationSettings({ ...conversationSettingsRef.current, privateSession: !conversationSettingsRef.current.privateSession }); setShowMore(false); }} aria-label={conversationSettings.privateSession ? "Private session: on" : "Private session: off"}>{conversationSettings.privateSession ? "Private session: on" : "Private session: off"}<span>{conversationSettings.privateSession ? "New captions and replies stay out of local storage." : "Keep this conversation only while using Cadence."}</span></button>
                    <button type="button" onClick={() => { setShowMemory(true); setShowMore(false); }}>What Cadence remembers<span>View or clear local people and topics.</span></button>
                    <button type="button" aria-label="Privacy controls" onClick={() => { setShowPrivacy(true); setShowMore(false); }}>Privacy controls<span>Review real-mode permission and local data.</span></button>
                    <button type="button" onClick={() => { toggleTheme(); setShowMore(false); }}>{theme === "dark" ? "Use light mode" : "Use dark mode"}<span>Change this device&apos;s appearance.</span></button>
                    <button type="button" onClick={() => { clearLocalSession(); setShowMore(false); }}>Clear this session<span>Remove this conversation from this device.</span></button>
                  </div>
                </details>
                <details className="more-menu-section" onToggle={(event) => { if (!event.currentTarget.open) return; document.querySelectorAll<HTMLDetailsElement>("#more-menu details[open]").forEach((section) => { if (section !== event.currentTarget) section.open = false; }); }}>
                  <summary>Help &amp; testing</summary>
                  <div className="more-menu-actions">
                    <button type="button" onClick={() => { setTutorialStep(0); setShowMore(false); }}>Take a quick tour<span>Learn the main controls in under a minute.</span></button><button type="button" onClick={() => { setShowPartnerGuide(true); setShowMore(false); }}>For conversation partners<span>A 30-second way to help.</span></button>
                    <button type="button" onClick={() => { if (isDemoPlaying) setIsDemoPlaying(false); else playDemo(); setShowMore(false); }}>{isDemoPlaying ? "Stop demo conversation" : "Play demo conversation"}<span>Practice with a safe scripted conversation.</span></button>
                    <button type="button" onClick={() => { setShowDebugLog(true); setShowMore(false); }}>Debug session recording<span>For testing only. Saved on this device.</span></button>
                    <button type="button" onClick={() => { setShowAbout(true); setShowMore(false); }}>About Cadence<span>System status and how Cadence works.</span></button>
                  </div>
                </details>
              </div>}
            </div>
          </div>
        </header>

        {!isOnline && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fff3e6] px-4 py-3 text-sm font-semibold text-[#80511c]" role="status"><p><span className="font-black">Offline mode.</span> Your local replies, quick phrases, needs, and device speech are ready.</p><button type="button" onClick={() => setShowBackupBoard(true)} className="min-h-11 rounded-xl border border-[#d69a4d] bg-white px-3 text-sm font-bold text-[#80511c] hover:bg-[#fff8ee] focus:outline-none focus:ring-4 focus:ring-[#f2c98d]">Open essentials</button></div>}
        <div className="mt-4 grid gap-5 sm:mt-6 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0" aria-label="Communication companion">
            <section className="rounded-2xl border border-[#dce6df] bg-white p-3 sm:rounded-3xl sm:p-5" aria-labelledby="transcript-heading"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">Room transcript</p><h2 id="transcript-heading" className="mt-0.5 text-base font-bold sm:mt-1 sm:text-lg">What&apos;s being said</h2></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-xs ${conversationSettings.privateSession ? "bg-[#e3f4eb] text-[#176746]" : "bg-[#f1f5f2] text-[#54706b]"}`} role="status">{conversationSettings.privateSession ? "Private" : listenStatus === "listening" ? "Listening" : isDemoPlaying ? "Demo playing" : "Ready"}</span></div>{listenStatus === "listening" && listeningFeedback && <p className="mt-2 truncate text-xs font-semibold text-[#176746]" role="status">{listeningFeedback}</p>}{transcript.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-[#4b675e]">Turn on Listen when people begin talking. Cadence will prepare replies from the conversation.</p> : <><div className="mt-2 flex items-center justify-between gap-2 sm:hidden"><p className="truncate text-sm text-[#4b675e]"><span className="font-bold text-[#294841]">{transcript.at(-1)?.speaker}:</span> {transcript.at(-1)?.text}</p><button type="button" onClick={() => setSpeakerTurn(transcript.at(-1) ?? null)} className="min-h-10 shrink-0 rounded-xl px-2 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Who said this?</button></div><div className="mt-3 hidden max-h-44 space-y-2 overflow-y-auto pr-1 sm:block" aria-live="polite" aria-relevant="additions">{transcript.map((turn, index) => <TranscriptLine key={turn.id} turn={turn} isLatest={index === transcript.length - 1} onName={() => setSpeakerTurn(turn)} />)}<div ref={transcriptEnd} /></div></>}</section>

            <section id="replies" className="mt-4 scroll-mt-4 sm:mt-8" aria-labelledby="replies-heading"><div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">{suggestionMode === "initiate" ? "Your opening" : "Your next thought"}</p><h1 id="replies-heading" className="mt-0.5 text-xl font-bold tracking-tight sm:mt-1 sm:text-3xl">{suggestionMode === "initiate" ? "Start the conversation" : suggestions.length ? "Choose a reply" : "Ready when you are"}</h1><p className="mt-0.5 text-sm text-[#54706b] sm:mt-1 sm:text-base">{suggestionMode === "initiate" ? "Tap an opener to speak it." : suggestions.length ? "Tap a reply to speak it." : "Listen to the room, or start something yourself."}</p></div><div className="flex flex-wrap items-center gap-1 sm:gap-2"><button type="button" onClick={() => void startSomething()} disabled={isInitiating} className="min-h-10 rounded-xl bg-[#1f7a57] px-2.5 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 sm:min-h-11 sm:px-3">{isInitiating ? "Starting" : "Start something"}</button><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-xs ${predictionStatus === "ready" ? "bg-[#e3f4eb] text-[#176746]" : "bg-[#f1f5f2] text-[#54706b]"}`} role="status">{predictionStatus === "ready" ? "Ready" : "Preparing replies…"}</span><button type="button" onClick={() => refreshPredictions(transcriptForModel())} disabled={isRefreshing || transcript.length === 0} className="min-h-10 rounded-xl px-2.5 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 sm:min-h-11 sm:px-3">{isRefreshing ? "Preparing…" : "Refresh"}</button></div></div>{predictionStatus === "preparing" && <p className="mt-2 text-xs font-semibold text-[#54706b]" role="status">Keeping your current replies ready while Cadence prepares the next set.</p>}{(isScanningMode || isEyeGazeActive) && <div className="mt-3"><p className="inline-flex max-w-full rounded-xl bg-[#102823] px-3 py-2 text-xs font-bold text-white" role="status">{isEyeGazeActive ? `Eye gaze on · ${estimatedGazePoint ? `${Math.round(estimatedGazePoint.confidence * 100)}%` : "finding you"} · gentle aim assist near visible choices · ${activeGazeTarget?.label ?? gazeCandidateTarget?.label ?? "move toward a visible choice"}` : "Scanning is on · Press Space or Enter to select"}</p></div>}<div className={`mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 xl:grid-cols-4 ${predictionStatus === "ready" ? "motion-safe:animate-[pulse_0.55s_ease-out_1]" : ""}`}>{suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} gazeTargetId={`suggestion-${suggestion.id}`} suggestion={suggestion} onSpeak={addSpoken} disabled={isSpeaking} isScanningHighlighted={highlightedTargetId === `suggestion-${suggestion.id}`} />)}</div>{!suggestions.length && <p className="mt-4 rounded-2xl border border-dashed border-[#d5e0d9] bg-white px-4 py-4 text-sm leading-relaxed text-[#54706b]">When someone speaks, Cadence will stage replies here. You can also choose <span className="font-bold text-[#315a4b]">Start something</span> to open the conversation in your own words.</p>}{error && <p className="mt-4 rounded-xl bg-[#fff0eb] px-4 py-3 text-sm font-semibold text-[#9a3c1b]" role="alert">{error}</p>}</section>

            {contextUndo && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5c5bc] bg-[#fff7f3] px-4 py-3 text-sm text-[#7f3b24]" role="status"><p>Caption removed from reply context.</p><button type="button" onClick={restoreTranscriptContext} className="min-h-10 rounded-xl border border-[#d9aaa0] bg-white px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Undo</button></div>}
            <section className="mt-5 rounded-3xl border border-[#dce6df] bg-white p-4 sm:mt-7 sm:p-5" aria-label="More ways to respond">
              <button type="button" onClick={() => setShowQuickControls((open) => !open)} aria-expanded={showQuickControls} aria-controls="quick-controls" className="flex min-h-12 w-full items-center justify-between text-left text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] lg:hidden"><span>More ways to respond</span><span aria-hidden="true">{showQuickControls ? "−" : "+"}</span></button>
              <div className="mt-2 flex justify-end lg:hidden"><InfoTip label="More ways to respond">Open this for short reactions, feelings, tone, and either generated or exact words. It stays closed until you need it.</InfoTip></div>
              <div id="quick-controls" className={`${showQuickControls ? "block" : "hidden"} lg:block`}>
                <button type="button" onClick={() => setShowConversationSetup(true)} className="mb-4 flex min-h-11 w-full items-center justify-between rounded-xl border-b border-[#e1ebe5] px-1 pb-3 text-left text-sm font-bold text-[#315a4b] hover:text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]"><span>{conversationSettings.mode} · {conversationSettings.energy} energy</span><span>Set up</span></button>
                <div className="grid gap-5 pt-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
                  <div><p className="text-sm font-bold text-[#3e5d53]">Quick reactions</p><div className="mt-3 flex flex-wrap gap-2">{quickReplies.map((reply) => <QuickButton key={reply} text={reply} onClick={addSpoken} gazeTargetId={`reaction-${reply}`} isScanningHighlighted={highlightedTargetId === `reaction-${reply}`} />)}{intents.map((intent) => <QuickButton key={intent} text={intent} onClick={addSpoken} />)}</div></div>
                  <div><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => setShowFeelingControls((open) => !open)} aria-expanded={showFeelingControls} className="min-h-11 rounded-xl px-1 text-sm font-bold text-[#3e5d53] hover:text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Feelings {showFeelingControls ? "−" : "+"}</button><button type="button" onClick={() => setShowFeelings(true)} className="min-h-10 rounded-xl px-2 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Edit</button></div>{showFeelingControls && <div className="mt-3 flex flex-wrap gap-2">{feelings.map((feeling, index) => <QuickButton key={feeling} text={feeling} onClick={speakFeeling} gazeTargetId={`feeling-${index}`} isScanningHighlighted={highlightedTargetId === `feeling-${index}`} />)}</div>}</div>
                  <div className="mt-4 border-t border-[#e3ebe6] pt-3"><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => setShowRepairControls((open) => !open)} aria-expanded={showRepairControls} className="min-h-11 rounded-xl px-1 text-sm font-bold text-[#3e5d53] hover:text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Repair a mix-up {showRepairControls ? "−" : "+"}</button><button type="button" onClick={() => setShowRepairs(true)} aria-label="Edit repair phrases" className="min-h-10 rounded-xl px-2 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Edit</button></div>{showRepairControls && <div className="mt-3 flex flex-wrap gap-2">{repairPhrases.map((phrase, index) => <QuickButton key={phrase} text={phrase} onClick={speakRepair} gazeTargetId={`repair-${index}`} isScanningHighlighted={highlightedTargetId === `repair-${index}`} />)}</div>}</div><fieldset className="shrink-0"><legend className="text-sm font-bold text-[#3e5d53]">Tone</legend><div className="mt-3 flex gap-2">{tones.map((option) => <button key={option} type="button" onClick={() => void selectTone(option)} disabled={isRefreshing} aria-pressed={tone === option} className={`min-h-11 rounded-xl border px-4 text-sm font-bold capitalize transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 ${tone === option ? "border-[#1f7a57] bg-[#1f7a57] text-white" : "border-[#d5e0d9] bg-white text-[#416158] hover:bg-[#edf5ef]"}`}>{option}</button>)}</div></fieldset>
                </div>
                <div className="mt-5 border-t border-[#e3ebe6] pt-4"><div className="flex gap-2" role="tablist" aria-label="Choose response action"><button type="button" role="tab" aria-selected={composerMode === "generate"} onClick={() => setComposerMode("generate")} className={`min-h-11 rounded-xl px-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${composerMode === "generate" ? "bg-[#1f7a57] text-white" : "bg-[#edf5ef] text-[#315a4b]"}`}>Make replies</button><button type="button" role="tab" aria-selected={composerMode === "speak"} onClick={() => setComposerMode("speak")} className={`min-h-11 rounded-xl px-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${composerMode === "speak" ? "bg-[#1f7a57] text-white" : "bg-[#edf5ef] text-[#315a4b]"}`}>Speak exactly</button></div>{composerMode === "generate" ? <form className="mt-3" onSubmit={handleExpand}><label htmlFor="keyword" className="text-sm font-bold text-[#3e5d53]">Start with a word or short idea</label><p className="mt-1 text-xs text-[#607a70]">Type it, or say a few words and Cadence will make full replies.</p><div className="mt-2 flex flex-wrap gap-2"><input id="keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={40} placeholder="For example: picnic" className="min-h-12 min-w-0 basis-full rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd] sm:basis-auto sm:flex-1" /><button type="button" onClick={startVoiceSteer} aria-pressed={isVoiceSteering} aria-label={isVoiceSteering ? "Stop listening for your idea" : "Speak a short idea to make replies"} className={`min-h-12 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${isVoiceSteering ? "bg-[#173d3a] text-white" : "border border-[#9fceb3] bg-white text-[#1f7a57] hover:bg-[#edf5ef]"}`}>{isVoiceSteering ? "Listening…" : "Speak idea"}</button><button type="submit" disabled={isExpanding || !keyword.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{isExpanding ? "Thinking" : "Make"}</button></div><p className="sr-only" role="status" aria-live="polite">{isVoiceSteering ? "Listening for a short idea." : ""}</p></form> : <form className="mt-3" onSubmit={handleCustomSpeak}><label htmlFor="custom-message" className="text-sm font-bold text-[#3e5d53]">Speak your own words</label><div className="mt-2 flex gap-2"><input id="custom-message" value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} maxLength={600} placeholder="Type exactly what you want to say" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={!customMessage.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Speak</button></div></form>}</div>
              </div>
            </section>
          </section>

          <aside className="rounded-3xl border border-[#dce6df] bg-white p-4 xl:self-start xl:p-5" aria-label="Your spoken log"><div className="flex items-center justify-between"><div><p className="eyebrow">Your voice</p><h2 className="mt-1 text-xl font-bold tracking-tight xl:text-2xl">Spoken</h2></div><button type="button" onClick={() => setShowSpoken((open) => !open)} aria-expanded={showSpoken} aria-controls="spoken-log" className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] xl:hidden">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} {showSpoken ? "−" : "+"}</button><span className="hidden h-10 w-10 place-items-center rounded-full bg-[#edf5ef] text-[#1f7a57] xl:grid" aria-hidden="true">~</span></div><div id="spoken-log" className={`${showSpoken ? "block" : "hidden"} xl:block`}><p className="mt-3 text-xs font-semibold leading-relaxed text-[#5b786a]">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} · ~{sessionImpact.tapsUsed} {sessionImpact.tapsUsed === 1 ? "tap" : "taps"} · ~{(sessionImpact.secondsSaved / 60).toFixed(1)} min saved · ~{sessionImpact.speedup.toFixed(1)}x faster</p><p className="mt-1 text-xs text-[#789087]">Based on {AAC_TYPING_WORDS_PER_MINUTE} words/min typing.</p>{participationSummary.averageResponseSeconds !== null && <p className="mt-2 text-xs font-semibold text-[#5b786a]">Average time to reply: ~{participationSummary.averageResponseSeconds}s.</p>}{spoken.length > 0 && <div className="mt-3 rounded-xl bg-[#f8fbf9] p-3"><p className="text-xs font-bold text-[#315a4b]">Did the last reply sound like you?</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => setParticipationEvents((events) => [...events, { kind: "rated_like_me", at: Date.now() }])} className="min-h-10 rounded-lg border border-[#9fceb3] bg-white px-3 text-xs font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Yes</button><button type="button" onClick={() => setParticipationEvents((events) => [...events, { kind: "rated_not_me", at: Date.now() }])} className="min-h-10 rounded-lg border border-[#d9aaa0] bg-white px-3 text-xs font-bold text-[#9a3c1b] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Not quite</button></div>{participationSummary.soundsLikeMePercent !== null && <p className="mt-2 text-xs text-[#5b786a]">{participationSummary.soundsLikeMePercent}% of ratings say replies sound like me.</p>}</div>}<div className="mt-5 space-y-3" aria-live="polite">{spoken.length ? spoken.map((item) => <div key={item.id} className="rounded-2xl bg-[#f1f7f3] p-4"><p className="text-base font-semibold leading-relaxed">{item.text}</p><p className="mt-2 text-xs font-bold uppercase tracking-wider text-[#5d8371]">1 tap · ~{Math.round(item.impact.secondsSaved)}s saved</p></div>) : <div className="rounded-2xl border border-dashed border-[#d0ddd5] bg-[#fafcfb] p-5 text-sm leading-relaxed text-[#5c746d]">Your selected replies appear here.</div>}</div></div></aside>
        </div>
      </div>
    </main>
  );
}

function currentTime() { return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()); }

function TranscriptLine({ turn, isLatest, onName }: { turn: TranscriptTurn; isLatest: boolean; onName: () => void }) { return <article className={`gap-3 ${isLatest ? "flex" : "hidden sm:flex"}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#edf3ef] text-sm font-bold text-[#416158]">{turn.speaker[0]}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">{turn.speaker}</p><time className="text-xs font-medium text-[#859992]">{turn.time}</time></div><p className="mt-0.5 text-sm leading-relaxed text-[#4b675e]">{turn.text}</p><button type="button" onClick={onName} className="mt-1 min-h-9 rounded-lg px-1 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Who said this?</button></div></article>; }

function SpeakerNameDialog({ turn, suggestions, onClose, onSave }: { turn: TranscriptTurn; suggestions: string[]; onClose: () => void; onSave: (id: string, speaker: string) => void }) { const [speaker, setSpeaker] = useState(turn.speaker); const names = suggestions.filter((name) => name && name !== turn.speaker).slice(0, 8); return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="speaker-name-title" className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"><p className="eyebrow">Caption speaker</p><h2 id="speaker-name-title" className="mt-2 text-2xl font-bold tracking-tight">Who said this?</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">This is a local label, not a voice guess. Cadence will use it to better ground replies.</p><p className="mt-4 rounded-xl bg-[#f1f7f3] p-3 text-sm text-[#315a4b]">“{turn.text}”</p>{names.length > 0 && <div className="mt-4 flex flex-wrap gap-2" aria-label="Known people">{names.map((name) => <button key={name} type="button" onClick={() => setSpeaker(name)} className="min-h-11 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{name}</button>)}</div>}<label htmlFor="speaker-name" className="mt-5 block text-sm font-bold text-[#315a4b]">Name</label><input id="speaker-name" value={speaker} onChange={(event) => setSpeaker(event.target.value)} maxLength={80} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => onSave(turn.id, speaker)} disabled={!speaker.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Use this name</button></div></section></div>; }

function PersonalVocabularyDialog({ vocabulary, userName, onClose, onSave }: { vocabulary: PersonalVocabularyEntry[]; userName: string; onClose: () => void; onSave: (vocabulary: PersonalVocabularyEntry[]) => void }) {
  const [draft, setDraft] = useState(() => formatPersonalVocabulary(vocabulary));
  useEffect(() => setDraft(formatPersonalVocabulary(vocabulary)), [vocabulary]);
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="vocabulary-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Local caption help</p><h2 id="vocabulary-title" className="mt-2 text-2xl font-bold tracking-tight">Words Cadence should recognize</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Correct recurring names, nicknames, places, or terms before they reach replies. This stays in this browser and never identifies who spoke.</p></div><button type="button" onClick={onClose} aria-label="Close words Cadence should recognize" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div>{userName && <p className="mt-4 rounded-xl bg-[#f1f7f3] p-3 text-sm text-[#315a4b]">Your name is <strong>{userName}</strong>. Cadence will never use it as a room speaker label unless you explicitly label a caption that way.</p>}<label htmlFor="personal-vocabulary" className="mt-5 block text-sm font-bold text-[#315a4b]">One correction per line</label><textarea id="personal-vocabulary" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1600} placeholder={"Jogn = John\nMya = Maya\nKary = Cary"} className="mt-2 min-h-40 w-full rounded-2xl border border-[#b9d7c6] bg-[#fbfefb] p-4 font-mono text-sm leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><p className="mt-2 text-xs leading-relaxed text-[#607a70]">Format: what the browser hears <strong>=</strong> what Cadence should write. Blank or incomplete lines are ignored.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => { onSave(parsePersonalVocabulary(draft)); onClose(); }} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save words</button></div></section></div>;
}

function ConversationKitsDialog({ kits, settings, onApply, onClose, onDelete, onSave }: { kits: ConversationKit[]; settings: ConversationSettings; onApply: (kit: ConversationKit) => void; onClose: () => void; onDelete: (id: string) => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  const save = () => { if (!name.trim()) return; onSave(name); setName(""); };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="conversation-kits-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Local contexts</p><h2 id="conversation-kits-title" className="mt-2 text-2xl font-bold tracking-tight">Conversation kits</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Save a context you use often, such as family dinner, a doctor visit, or work. Then restore its people, boundaries, and energy with one tap.</p></div><button type="button" onClick={onClose} aria-label="Close conversation kits" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); save(); }}><label className="sr-only" htmlFor="conversation-kit-name">Name this conversation kit</label><input id="conversation-kit-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={`Save current ${settings.mode} setup as...`} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={!name.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Save kit</button></form><div className="mt-5 space-y-3">{kits.length ? kits.map((kit) => <article key={kit.id} className="rounded-2xl border border-[#d9e4dd] bg-[#fbfdfb] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-[#244b40]">{kit.name}</h3><p className="mt-1 text-sm text-[#607a70]">{kit.settings.mode} · {kit.settings.energy} energy{kit.settings.peopleHere.length ? ` · ${kit.settings.peopleHere.join(", ")}` : ""}</p></div><div className="flex gap-2"><button type="button" onClick={() => onDelete(kit.id)} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Delete</button><button type="button" onClick={() => onApply(kit)} className="min-h-11 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Use kit</button></div></div></article>) : <p className="rounded-2xl border border-dashed border-[#d5e0d9] p-4 text-sm leading-relaxed text-[#607a70]">No kits yet. Set up a conversation, then save it here for next time.</p>}</div><button type="button" onClick={onClose} className="mt-6 min-h-12 rounded-xl border border-[#9fceb3] px-5 font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></section></div>;
}

function SuggestionCard({ suggestion, onSpeak, disabled = false, isScanningHighlighted = false, gazeTargetId }: { suggestion: Suggestion; onSpeak: (text: string) => Promise<void>; disabled?: boolean; isScanningHighlighted?: boolean; gazeTargetId?: string }) { const styles = { mint: "reply-card-mint", peach: "reply-card-peach", sky: "reply-card-sky", lilac: "reply-card-lilac" }; return <button type="button" data-cadence-gaze-id={gazeTargetId} onClick={() => void onSpeak(suggestion.text)} disabled={disabled} aria-label={disabled ? "Cadence is speaking. Stop audio before choosing another reply." : `Speak ${suggestion.label} reply: ${suggestion.text}`} aria-current={isScanningHighlighted || undefined} className={`reply-card group min-h-28 rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#2b7a5b] disabled:cursor-wait disabled:opacity-60 sm:min-h-48 sm:rounded-3xl sm:p-5 ${styles[suggestion.accent]} ${isScanningHighlighted ? "scale-[1.02] bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4] shadow-2xl" : ""}`}><span className="reply-intent rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:py-1 sm:text-xs">{suggestion.label}</span><p className="mt-2 text-sm font-semibold leading-snug sm:mt-4 sm:text-lg sm:leading-relaxed">{suggestion.text}</p><span className="reply-speak mt-2 inline-flex items-center gap-1 text-xs font-bold sm:mt-4 sm:text-sm" aria-hidden="true">{disabled ? "Speaking…" : "Speak"}</span></button>; }

function QuickButton({ text, spokenText = text, onClick, isScanningHighlighted = false, gazeTargetId }: { text: string; spokenText?: string; onClick: (text: string) => Promise<void>; isScanningHighlighted?: boolean; gazeTargetId?: string }) { return <button type="button" data-cadence-gaze-id={gazeTargetId} onClick={() => void onClick(spokenText)} aria-label={`Speak ${spokenText}`} aria-current={isScanningHighlighted || undefined} className={`min-h-11 rounded-xl border border-[#d5e0d9] bg-white px-4 text-sm font-bold text-[#416158] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${isScanningHighlighted ? "scale-105 bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-white shadow-lg" : ""}`}>{text}</button>; }

function Onboarding({ onStart, onTour, onSetupVoice, onSetupProfile, onSetupAccess }: { onStart: () => void; onTour: () => void; onSetupVoice: () => void; onSetupProfile: () => void; onSetupAccess: () => void }) { return <div className="onboarding-backdrop fixed inset-0 z-50 grid place-items-center p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="onboarding-dialog w-full max-w-md rounded-[2rem] p-6 shadow-2xl sm:p-8"><p className="eyebrow">Welcome to Cadence</p><h2 id="welcome-title" className="mt-2 text-3xl font-bold tracking-tight">You&apos;re ready to join in.</h2><p className="onboarding-copy mt-3 leading-relaxed">No training needed. Turn on Listen when people talk, then choose a ready reply to speak.</p><button type="button" autoFocus onClick={onStart} className="onboarding-primary mt-7 min-h-16 w-full rounded-2xl px-5 text-base font-bold text-white focus:outline-none focus:ring-4">Start</button><button type="button" onClick={onStart} className="onboarding-skip mt-3 min-h-12 w-full rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4">Skip for now</button><div className="mt-6 border-t pt-5"><p className="onboarding-kicker text-center text-sm font-bold">Optional setup, whenever you are ready</p><div className="mt-3 grid grid-cols-2 gap-3"><button type="button" onClick={onTour} className="onboarding-option min-h-[4.75rem] rounded-xl px-3 py-3 text-left text-sm font-bold focus:outline-none focus:ring-4">Show me how<span>Quick tour</span></button><button type="button" onClick={onSetupVoice} className="onboarding-option min-h-[4.75rem] rounded-xl px-3 py-3 text-left text-sm font-bold focus:outline-none focus:ring-4">Your voice<span>Sound like you</span></button><button type="button" onClick={onSetupProfile} className="onboarding-option min-h-[4.75rem] rounded-xl px-3 py-3 text-left text-sm font-bold focus:outline-none focus:ring-4">My details<span>Useful context</span></button><button type="button" onClick={onSetupAccess} className="onboarding-option min-h-[4.75rem] rounded-xl px-3 py-3 text-left text-sm font-bold focus:outline-none focus:ring-4">Access options<span>Switch or gaze</span></button></div></div></section></div>; }

function PrivacyDialog({ hasRealModeConsent, onClose, onConsent, onErase }: { hasRealModeConsent: boolean; onClose: () => void; onConsent: () => void; onErase: () => void }) {
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="privacy-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Your data</p><h2 id="privacy-title" className="mt-2 text-2xl font-bold tracking-tight">Privacy and real mode</h2></div><button type="button" onClick={onClose} aria-label="Close privacy and data" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-4 text-sm leading-relaxed text-[#4e6960]">Cadence keeps your profile, voice card, quick phrases, settings, and memory in this browser. Mock mode stays on this device. When real mode is enabled, only the text needed for the action you choose is sent to OpenAI for replies, voice learning, rewrites, or speech.</p><p className="mt-3 text-sm leading-relaxed text-[#4e6960]">Real mode is optional. You can keep using local quick phrases, offline replies, and device speech without accepting it.</p><div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-[#e1ebe5] pt-5"><button type="button" onClick={onErase} className="min-h-12 rounded-xl border border-[#d9aaa0] px-4 font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Erase all local data</button><div className="flex gap-2"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={onConsent} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{hasRealModeConsent ? "Real mode accepted" : "I understand"}</button></div></div></section></div>;
}

function VoicePicker({ selectedVoice, isPreviewing, onClose, onPreview, onSelect }: { selectedVoice: TtsVoice; isPreviewing: boolean; onClose: () => void; onPreview: (voice: TtsVoice) => void; onSelect: (voice: TtsVoice) => void }) {
  const [draftVoice, setDraftVoice] = useState(selectedVoice);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="speaking-voice-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Speaking voice</p><h2 id="speaking-voice-title" className="mt-2 text-2xl font-bold tracking-tight">Choose how Cadence speaks.</h2></div><button type="button" onClick={onClose} aria-label="Close speaking voice picker" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-3 text-sm leading-relaxed text-[#4e6960]">Choose an OpenAI system voice. Your choice stays on this device and is used for every spoken reply.</p><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{ttsVoiceOptions.map((voice) => <button key={voice.id} type="button" onClick={() => setDraftVoice(voice.id)} aria-pressed={voice.id === draftVoice} className={`min-h-12 rounded-xl border px-3 text-left text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${voice.id === draftVoice ? "border-[#1f7a57] bg-[#e3f4eb] text-[#176746]" : "border-[#d5e0d9] bg-white text-[#315a4b] hover:bg-[#edf5ef]"}`}><span className="block">{voice.name}</span>{voice.recommended && <span className="mt-0.5 block text-[11px] font-semibold opacity-75">Recommended</span>}</button>)}</div><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void onPreview(draftVoice)} disabled={isPreviewing} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{isPreviewing ? "Playing…" : "Preview voice"}</button><button type="button" onClick={() => onSelect(draftVoice)} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Use this voice</button></div><p className="mt-4 text-xs leading-relaxed text-[#607a70]">Voice names are provided by OpenAI. Cadence does not assign gender labels to voices; choose by listening.</p></section></div>;
}

const tutorialSteps = [
  { title: "Listen when you want", text: "Turn Listen on to add live room captions. Turn it off any time; you can still use prepared replies and quick phrases." },
  { title: "Choose a prepared reply", text: "Cadence uses the newest room turn to stage reply cards. Tap a card to review or speak it, depending on your preview preference." },
  { title: "Use quick words when timing matters", text: "Open More ways to respond for short reactions, feelings, a tone choice, or your own exact words." },
  { title: "Keep your place in the conversation", text: "Hold the floor speaks a brief placeholder. My needs opens care and comfort phrases that you can edit for yourself." },
  { title: "Choose the access method that fits", text: "Scanning works with Space, Enter, and compatible switches. Eye-gaze focus is an optional local-camera beta: it highlights a choice, and you always confirm before Cadence speaks." },
];

function TutorialDialog({ step, onClose, onStepChange }: { step: number; onClose: () => void; onStepChange: (step: number) => void }) {
  const current = tutorialSteps[step];
  const isLast = step === tutorialSteps.length - 1;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-description" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><p className="eyebrow">Quick tour · {step + 1} of {tutorialSteps.length}</p><button type="button" onClick={onClose} aria-label="Close tutorial" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><h2 id="tutorial-title" className="mt-4 text-3xl font-bold tracking-tight">{current.title}</h2><p id="tutorial-description" className="mt-3 text-base leading-relaxed text-[#4e6960]">{current.text}</p><div className="mt-7 flex items-center justify-between gap-3"><button type="button" onClick={() => onStepChange(Math.max(0, step - 1))} disabled={step === 0} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40">Back</button><button type="button" onClick={() => isLast ? onClose() : onStepChange(step + 1)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isLast ? "Start using Cadence" : "Next"}</button></div></section></div>;
}

const gazeCalibrationTargets = [
  { x: 0.15, y: 0.15, label: "upper left" },
  { x: 0.85, y: 0.15, label: "upper right" },
  { x: 0.5, y: 0.44, label: "center" },
  { x: 0.15, y: 0.62, label: "lower left" },
  { x: 0.85, y: 0.62, label: "lower right" },
];

const gazeValidationTarget = { x: 0.5, y: 0.16, label: "top center" };

function EyeGazeSetupDialog({ settings, status, statusMessage, feature, active, onClose, onStartCamera, onSettingsChange, onSave, onTurnOff }: { settings: EyeGazeSettings; status: EyeGazeStatus; statusMessage: string; feature: GazeFeature | null; active: boolean; onClose: () => void; onStartCamera: () => void; onSettingsChange: (settings: EyeGazeSettings) => void; onSave: (settings: EyeGazeSettings) => void; onTurnOff: () => void }) {
  const [samples, setSamples] = useState<GazeCalibrationSample[]>([]);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [pendingCalibration, setPendingCalibration] = useState<GazeCalibration | null>(null);
  const needsCalibration = !settings.calibration || isRecalibrating;
  const activeTarget = pendingCalibration ? gazeValidationTarget : gazeCalibrationTargets[samples.length];
  const canCapture = status === "ready" && Boolean(feature && feature.confidence >= 0.25) && Boolean(activeTarget);
  const captureTarget = () => {
    if (!feature || !activeTarget) return;
    if (pendingCalibration) {
      const estimate = estimateGazePoint(feature, pendingCalibration);
      if (!estimate) {
        setCalibrationError("Cadence could not validate that check. Try it again or recalibrate.");
        return;
      }
      const error = Math.hypot(estimate.x - gazeValidationTarget.x, estimate.y - gazeValidationTarget.y);
      if (error > 0.3) {
        setCalibrationError("The check was not close enough. Try it again, recalibrate, or continue and adjust later.");
        return;
      }
      setPendingCalibration(null);
      setIsRecalibrating(false);
      onSave({ consented: true, calibration: pendingCalibration, speed: settings.speed });
      return;
    }
    const nextSamples = [...samples, { ...feature, targetX: activeTarget.x, targetY: activeTarget.y }];
    setSamples(nextSamples);
    if (nextSamples.length !== gazeCalibrationTargets.length) return;
    const calibration = buildGazeCalibration(nextSamples);
    if (calibration) {
      setPendingCalibration(calibration);
    } else {
      setCalibrationError("Cadence could not calibrate from those looks. Please try again with your head steady.");
      setSamples([]);
    }
  };
  const needsCamera = status === "off" || status === "unsupported" || status === "error";
  if (needsCalibration && (status === "ready" || status === "no-face") && activeTarget) {
    const stepLabel = pendingCalibration ? "Check calibration" : `Target ${samples.length + 1} of ${gazeCalibrationTargets.length}`;
    const prompt = calibrationError ?? (status === "no-face" ? statusMessage : pendingCalibration ? "Look at the teal check target, then capture once." : `Look at the yellow target: ${activeTarget.label}.`);
    return <div className="fixed inset-0 z-[100] bg-[#102b24]/55" role="presentation"><div className={`pointer-events-none fixed z-[101] grid h-16 w-16 place-items-center rounded-full border-4 border-white text-xl font-black shadow-2xl sm:h-20 sm:w-20 sm:text-2xl ${pendingCalibration ? "bg-[#2dc6b3] text-[#102823]" : "bg-[#f7d341] text-[#102823]"}`} style={{ left: `${activeTarget.x * 100}%`, top: `${activeTarget.y * 100}%`, transform: "translate(-50%, -50%)" }} aria-hidden="true">{pendingCalibration ? "✓" : samples.length + 1}</div><section className="fixed inset-x-3 bottom-3 z-[102] mx-auto w-auto max-w-lg rounded-3xl bg-white p-4 shadow-2xl sm:inset-x-4 sm:bottom-6 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="gaze-calibration-title"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Eye-gaze calibration</p><h2 id="gaze-calibration-title" className="mt-1 text-lg font-black tracking-tight text-[#14352c] sm:text-xl">{stepLabel}</h2></div><button type="button" onClick={onClose} aria-label="Cancel calibration" className="grid h-10 w-10 place-items-center rounded-xl border border-[#b8d4c4] text-lg font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-1 text-sm leading-relaxed text-[#4e6960]" role="status">{prompt}</p><div className="mt-3 flex flex-wrap items-center gap-2">{!calibrationError && <button type="button" disabled={!canCapture} onClick={captureTarget} className="min-h-11 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{pendingCalibration ? "Check calibration" : "Capture this look"}</button>}{calibrationError && pendingCalibration && <><button type="button" onClick={() => setCalibrationError(null)} className="min-h-11 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Try again</button><button type="button" onClick={() => { if (!pendingCalibration) return; const calibration = pendingCalibration; setPendingCalibration(null); setIsRecalibrating(false); onSave({ consented: true, calibration, speed: settings.speed }); }} className="min-h-11 rounded-xl border border-[#9fceb3] bg-white px-4 text-sm font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Use this calibration</button></>}{calibrationError && <button type="button" onClick={() => { setSamples([]); setPendingCalibration(null); setCalibrationError(null); }} className="min-h-11 rounded-xl border border-[#9fceb3] bg-white px-4 text-sm font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Start again</button>}<button type="button" onClick={onClose} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button></div><p className="mt-2 text-xs leading-relaxed text-[#607a70]">Keep your head steady. Look at the visible target, then capture once. Nothing speaks automatically.</p></section></div>;
  }
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#102b24]/45 p-3 sm:p-4" role="presentation"><section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-[1.75rem] bg-white p-5 shadow-2xl sm:max-h-[90vh] sm:rounded-[2rem] sm:p-7" role="dialog" aria-modal="true" aria-labelledby="eye-gaze-title"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Experimental access</p><h2 id="eye-gaze-title" className="mt-1 text-2xl font-black tracking-tight text-[#14352c]">Eye-gaze focus</h2></div><button type="button" onClick={onClose} aria-label="Close eye-gaze settings" className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-[#b8d4c4] text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-3 text-sm leading-relaxed text-[#4e6960]">Uses your camera only on this device to move a focus highlight. Look at a reply, then use Select, Space, or Enter to confirm. It never speaks automatically.</p><div className="mt-3 rounded-2xl border border-[#c9e1d2] bg-[#f1f8f4] p-3 text-sm leading-relaxed text-[#315a4b]"><p className="font-bold">Camera stays local</p><p className="mt-1">Cadence does not upload or save video, face landmarks, or gaze samples. A small MediaPipe model downloads in your browser when you start.</p></div><fieldset className="mt-4"><legend className="text-sm font-bold text-[#315a4b]">Focus speed</legend><p className="mt-1 text-sm text-[#607a70]">Pick the speed that feels comfortable. Saved on this device.</p><div className="mt-2 grid grid-cols-3 gap-2">{gazeFocusSpeeds.map((speed) => <button key={speed} type="button" onClick={() => onSettingsChange({ ...settings, speed })} aria-pressed={settings.speed === speed} className={`min-h-11 rounded-xl border px-2 text-sm font-bold capitalize focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${settings.speed === speed ? "border-[#1f7a57] bg-[#1f7a57] text-white" : "border-[#cdd9d2] bg-white text-[#315a4b] hover:bg-[#edf5ef]"}`}>{speed === "responsive" ? "Fast" : speed}</button>)}</div></fieldset>{active && !isRecalibrating && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#e3f4eb] p-3 text-sm text-[#176746]" role="status"><p><span className="font-black">Eye-gaze focus is on.</span> Look at a visible reply, then confirm.</p><button type="button" onClick={onTurnOff} className="min-h-11 rounded-xl border border-[#8ebfa4] bg-white px-3 text-sm font-bold text-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Turn off</button></div>}{needsCalibration && <div className="mt-5"><h3 className="text-lg font-bold">{pendingCalibration ? "Check your calibration" : "Calibrate in five looks"}</h3><p className="mt-1 text-sm text-[#607a70]">{pendingCalibration ? "Look at the teal check target, then capture once. Cadence only turns gaze on if the check is close enough." : "A caregiver may help press Capture. Keep your head steady and look at each numbered yellow target before capturing it."}</p>{needsCamera ? <div className="mt-4"><p className={`rounded-xl border p-3 text-sm font-bold ${status === "error" || status === "unsupported" ? "border-[#e9b6a9] bg-[#fff0eb] text-[#9a3c1b]" : "border-[#dbe7df] bg-[#f8fbf9] text-[#315a4b]"}`} role={status === "error" || status === "unsupported" ? "alert" : "status"}>{status === "error" || status === "unsupported" ? statusMessage || "Cadence could not start local eye-gaze focus." : "Start the camera, allow access in your browser, then Cadence will show target 1."}</p><button type="button" onClick={onStartCamera} className="mt-3 min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{status === "error" || status === "unsupported" ? "Try local camera again" : "Start local camera"}</button></div> : <div className="mt-4 rounded-xl border border-[#dbe7df] p-4"><p className="font-bold text-[#315a4b]" role="status">{calibrationError ?? (status === "starting" ? (statusMessage || "Starting camera and local model...") : status === "no-face" ? statusMessage : pendingCalibration ? `Look at the check target: ${gazeValidationTarget.label}.` : `Look at target ${samples.length + 1} of ${gazeCalibrationTargets.length}: ${activeTarget?.label}.`)}</p>{calibrationError ? <button type="button" onClick={() => { setSamples([]); setPendingCalibration(null); setCalibrationError(null); }} className="mt-3 min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Start calibration again</button> : <button type="button" disabled={!canCapture} onClick={captureTarget} className="mt-3 min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{pendingCalibration ? "Check calibration" : "Capture this look"}</button>}</div>}</div>}{settings.calibration && !active && !isRecalibrating && <div className="mt-5 rounded-2xl border border-[#dbe7df] p-4"><p className="font-bold text-[#315a4b]">Calibration saved on this device.</p><p className="mt-1 text-sm text-[#607a70]">Start the local camera each time you want to use gaze focus. You can recalibrate whenever the camera position changes.</p><button type="button" onClick={onStartCamera} className="mt-4 min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Start eye-gaze focus</button></div>}{settings.calibration && !isRecalibrating && <button type="button" onClick={() => { onTurnOff(); setSamples([]); setPendingCalibration(null); setCalibrationError(null); setIsRecalibrating(true); }} className="mt-4 min-h-11 rounded-xl border border-[#9fceb3] px-3 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Recalibrate</button>}<div className="mt-6 flex justify-end"><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Done, return to Cadence</button></div></section></div>;
}
function InfoTip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  return <span className="relative inline-flex"><button type="button" aria-label={`More information: ${label}`} aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full border border-[#b8d4c4] bg-white text-sm font-black text-[#1f7a57] shadow-sm hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">i</button>{open && <span role="tooltip" className="absolute bottom-full right-0 z-40 mb-2 w-56 rounded-xl bg-[#173d3a] p-3 text-left text-xs font-medium leading-relaxed text-white shadow-xl">{children}</span>}</span>;
}

function TranscriptRepairDialog({ turn, onClose, onConfirm }: { turn: TranscriptTurn; onClose: () => void; onConfirm: (id: string, text: string) => void }) {
  const [text, setText] = useState(turn.text);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="caption-repair-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><p className="eyebrow">Listening check</p><h2 id="caption-repair-title" className="mt-2 text-2xl font-bold tracking-tight">Was this caption right?</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Cadence will not use this caption to prepare replies until you confirm it.</p><label htmlFor="caption-repair" className="mt-5 block text-sm font-bold text-[#315a4b]">What was said</label><textarea id="caption-repair" value={text} onChange={(event) => setText(event.target.value)} maxLength={800} className="mt-2 min-h-28 w-full rounded-2xl border border-[#b9d7c6] bg-[#fbfefb] p-4 text-base leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Leave unconfirmed</button><button type="button" onClick={() => onConfirm(turn.id, text)} disabled={!text.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Use this caption</button></div></section></div>;
}

function BackupBoardDialog({ needs, feelings, favorites, profile, onClose, onSpeak }: { needs: string[]; feelings: string[]; favorites: string[]; profile: PersonalProfile; onClose: () => void; onSpeak: (text: string) => void }) {
  const phrases = Array.from(new Set([...needs, ...feelings, ...favorites])).slice(0, 24);
  const downloadPlan = () => {
    const name = profile.preferredName || profile.fullName || "Cadence user";
    const content = [
      `Cadence communication plan: ${name}`,
      "",
      "How to support me",
      "• Speak naturally and give me time to choose a response.",
      "• I may use Cadence to speak a prepared reply or a quick phrase.",
      "• If a caption is marked uncertain, please repeat or clarify before expecting a reply.",
      "",
      "Care and comfort phrases",
      ...needs.map((phrase) => `• ${phrase}`),
      "",
      "Connection phrases",
      ...feelings.map((phrase) => `• ${phrase}`),
      ...(favorites.length ? ["", "Saved replies", ...favorites.map((phrase) => `• ${phrase}`)] : []),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cadence-communication-plan.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="backup-board-title" className="mx-auto my-4 w-full max-w-3xl rounded-[2rem] bg-white p-5 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Always available</p><h2 id="backup-board-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Offline backup board</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#607a70]">These saved phrases work without listening or replies. Choose one to speak it, or download a plain-text communication plan to keep with your care team.</p></div><button type="button" onClick={onClose} aria-label="Close offline backup board" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{phrases.map((phrase) => <button key={phrase} type="button" onClick={() => onSpeak(phrase)} className="min-h-16 rounded-2xl border border-[#cfe1d6] bg-[#f7fbf8] px-4 text-left text-base font-bold text-[#205342] hover:bg-[#eaf8ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{phrase}</button>)}</div><div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[#e1ebe5] pt-5"><button type="button" onClick={downloadPlan} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Download communication plan</button><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div></section></div>;
}

function FirstSpeechAffirmation({ onDismiss }: { onDismiss: () => void }) { return <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-[#b9ddc8] bg-white p-4 shadow-xl sm:bottom-6" role="status" aria-live="polite"><div className="flex items-center justify-between gap-3"><p className="text-base font-bold text-[#205342]">That&apos;s it - you&apos;re in the conversation.</p><button type="button" autoFocus onClick={onDismiss} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Got it</button></div></div>; }

function PartnerGuideDialog({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="partner-guide-title" className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">For conversation partners</p><h2 id="partner-guide-title" className="mt-2 text-2xl font-bold tracking-tight">A small pause makes room.</h2></div><button type="button" onClick={onClose} aria-label="Close partner guide" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-4 text-sm leading-relaxed text-[#4e6960]">No special app or account is needed for conversation partners. Speak naturally to the person, then leave a little room for them to choose, edit, or reject a reply.</p><ol className="mt-5 space-y-3 text-sm leading-relaxed text-[#315a4b]"><li><strong>1. Speak to the person, not the screen.</strong></li><li><strong>2. Pause after a thought.</strong> Cadence uses the captions to prepare choices.</li><li><strong>3. Wait for their chosen words.</strong> Suggestions are never automatic speech.</li><li><strong>4. Ask, do not assume.</strong> If a caption or reply seems off, the person can correct it.</li></ol><p className="mt-5 rounded-xl bg-[#edf5ef] p-3 text-sm font-semibold text-[#315a4b]">Cadence suggests. The person decides every word.</p><button type="button" onClick={onClose} className="mt-6 min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Got it</button></section></div>;
}
function AboutDialog({ isOnline, listenStatus, hasRealModeConsent, onClose, onTour }: { isOnline: boolean; listenStatus: LiveTranscriptionStatus; hasRealModeConsent: boolean; onClose: () => void; onTour: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="about-title" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">About Cadence</p><h2 id="about-title" className="mt-2 text-2xl font-bold tracking-tight">Stay in the conversation.</h2></div><button type="button" onClick={onClose} aria-label="Close about" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-4 leading-relaxed text-[#4e6960]">Cadence listens to complete room turns and prepares replies in your voice, so a thought can be spoken with one tap. Listen uses browser speech recognition when available.</p><div className="mt-4 rounded-2xl bg-[#f1f7f3] p-4 text-sm"><p className="font-bold text-[#315a4b]">System status</p><p className="mt-2 text-[#4e6960]">Connection: <strong>{isOnline ? "Online" : "Offline. Local tools ready"}</strong> · Captions: <strong>{listenStatus === "listening" ? "Listening" : listenStatus === "unsupported" ? "Unavailable" : "Ready"}</strong> · Online AI permission: <strong>{hasRealModeConsent ? "Allowed" : "Not enabled"}</strong></p><p className="mt-3 text-xs text-[#607a70]">Built with Next.js, React, TypeScript, Tailwind CSS, browser speech recognition, optional OpenAI replies and speech, local device storage, and Vercel.</p></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onTour} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Take the tour</button><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div></section></div>;
}

function FeelingsDialog({ feelings, onClose, onSpeak, onSave }: { feelings: string[]; onClose: () => void; onSpeak: (text: string) => void; onSave: (feelings: string[]) => void }) {
  const [draft, setDraft] = useState(feelings);
  const [newFeeling, setNewFeeling] = useState("");
  const updateFeeling = (index: number, text: string) => setDraft((current) => current.map((feeling, itemIndex) => itemIndex === index ? text : feeling));
  const addFeeling = () => {
    const text = newFeeling.trim();
    if (!text || draft.length >= 12) return;
    setDraft((current) => [...current, text]);
    setNewFeeling("");
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="feelings-title" className="mx-auto my-8 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Quick communication</p><h2 id="feelings-title" className="mt-2 text-2xl font-bold tracking-tight">Feelings</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Keep the words that help you connect close at hand. They are saved only in this browser.</p></div><button type="button" onClick={onClose} aria-label="Close feelings" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 space-y-3">{draft.map((feeling, index) => <div key={`${feeling}-${index}`} className="flex flex-wrap gap-2 sm:flex-nowrap"><button type="button" onClick={() => onSpeak(feeling)} disabled={!feeling.trim()} className="min-h-12 w-full rounded-xl border border-[#cfe1d6] bg-[#f7fbf8] px-4 text-left text-base font-bold text-[#205342] hover:bg-[#eaf8ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40 sm:min-w-0 sm:flex-1">{feeling || "Untitled feeling"}</button><input aria-label={`Edit feeling ${index + 1}`} value={feeling} onChange={(event) => updateFeeling(index, event.target.value)} maxLength={maxFeelingLength} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-3 text-sm outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:w-36 sm:flex-none" /><button type="button" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${feeling || "feeling"}`} className="min-h-12 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Remove</button></div>)}</div><div className="mt-5 flex gap-2 border-t border-[#e1ebe5] pt-5"><input value={newFeeling} onChange={(event) => setNewFeeling(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addFeeling(); } }} maxLength={maxFeelingLength} placeholder="Add a feeling" aria-label="Add a feeling" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={addFeeling} disabled={!newFeeling.trim() || draft.length >= 12} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Add</button></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={() => { onSave(draft); onClose(); }} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save feelings</button></div></section></div>;
}

function RepairPhrasesDialog({ phrases, onClose, onSpeak, onSave }: { phrases: string[]; onClose: () => void; onSpeak: (text: string) => void; onSave: (phrases: string[]) => void }) {
  const [draft, setDraft] = useState(phrases);
  const [newPhrase, setNewPhrase] = useState("");
  const updatePhrase = (index: number, value: string) => setDraft((current) => current.map((phrase, itemIndex) => itemIndex === index ? value : phrase));
  const addPhrase = () => {
    const next = newPhrase.trim();
    if (!next || draft.length >= 12) return;
    setDraft((current) => [...current, next]);
    setNewPhrase("");
  };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="repair-phrases-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-5 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Conversation repair</p><h2 id="repair-phrases-title" className="mt-2 text-2xl font-bold tracking-tight">Repair a mix-up</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Keep clear phrases nearby for corrections, repeats, and adding a thought. They stay only in this browser.</p></div><button type="button" onClick={onClose} aria-label="Close repair phrases" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 space-y-3">{draft.map((phrase, index) => <div key={`${phrase}-${index}`} className="flex flex-wrap gap-2 sm:flex-nowrap"><button type="button" onClick={() => onSpeak(phrase)} disabled={!phrase.trim()} className="min-h-12 w-full rounded-xl border border-[#cfe1d6] bg-[#f7fbf8] px-4 text-left text-base font-bold text-[#204d40] hover:bg-[#eaf8ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40 sm:min-w-0 sm:flex-1">{phrase || "Untitled repair"}</button><input aria-label={`Edit repair phrase ${index + 1}`} value={phrase} onChange={(event) => updatePhrase(index, event.target.value)} maxLength={maxRepairPhraseLength} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-3 text-sm outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:w-36 sm:flex-none" /><button type="button" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${phrase || "repair phrase"}`} className="min-h-12 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Remove</button></div>)}</div><div className="mt-5 flex gap-2 border-t border-[#e1ebe5] pt-5"><input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPhrase(); } }} maxLength={maxRepairPhraseLength} placeholder="Add a repair phrase" aria-label="Add a repair phrase" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={addPhrase} disabled={!newPhrase.trim() || draft.length >= 12} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Add</button></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={() => { onSave(draft); onClose(); }} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save repair phrases</button></div></section></div>;
}

function HelpPlanDialog({ plan, onClose, onSave }: { plan: HelpPlan; onClose: () => void; onSave: (plan: HelpPlan) => void }) {
  const [instruction, setInstruction] = useState(plan.instruction);
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="help-plan-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Personal safety plan</p><h2 id="help-plan-title" className="mt-2 text-2xl font-bold tracking-tight">What should happen next?</h2></div><button type="button" onClick={onClose} aria-label="Close help plan" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-3 text-sm leading-relaxed text-[#607a70]">Write a short reminder for you or a care partner, such as who to call or where to find your existing plan. Cadence stores this only in this browser.</p><aside className="mt-4 rounded-xl border border-[#f0c6ba] bg-[#fff7f3] p-3 text-sm leading-relaxed text-[#7f3b24]"><strong>Cadence does not contact, alert, text, or monitor anyone.</strong> For urgent help, follow your established care or emergency plan.</aside><label htmlFor="help-plan-instruction" className="mt-5 block text-sm font-bold text-[#315a4b]">Your reminder</label><textarea id="help-plan-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={maxHelpPlanLength} placeholder="For example: Ask Sam to follow the care plan posted by the phone." className="mt-2 min-h-28 w-full rounded-2xl border border-[#cddbd3] bg-[#fbfefb] p-4 text-base leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={() => { onSave({ instruction }); onClose(); }} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save reminder</button></div></section></div>;
}
function NeedsDialog({ needs, onClose, onSpeak, onSave, onOpenHelpPlan }: { needs: string[]; onClose: () => void; onSpeak: (text: string) => void; onSave: (needs: string[]) => void; onOpenHelpPlan: () => void }) {
  const [draft, setDraft] = useState(needs);
  const [newNeed, setNewNeed] = useState("");
  const updateNeed = (index: number, text: string) => setDraft((current) => current.map((need, itemIndex) => itemIndex === index ? text : need));
  const removeNeed = (index: number) => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
  const addNeed = () => {
    const text = newNeed.trim();
    if (!text || draft.length >= 16) return;
    setDraft((current) => [...current, text]);
    setNewNeed("");
  };
  const save = () => {
    onSave(draft);
    setDraft(sanitizeNeeds(draft));
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="needs-title" className="mx-auto my-4 w-full max-w-2xl rounded-[2rem] bg-white p-5 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Quick communication</p><h2 id="needs-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">My needs</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#607a70]">Choose a phrase to speak it clearly. These phrases stay in this browser and can be tailored for you.</p><aside className="mt-3 rounded-xl border border-[#f0c6ba] bg-[#fff7f3] px-3 py-2 text-xs leading-relaxed text-[#7f3b24]"><strong>Important:</strong> Cadence only speaks the phrase. It does not call, text, notify, or monitor anyone. Keep your usual care plan and low-tech backup available. <button type="button" onClick={onOpenHelpPlan} className="mt-2 block min-h-10 rounded-lg border border-[#d9aaa0] bg-white px-3 text-xs font-bold text-[#7f3b24] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Set a personal help reminder</button></aside></div><button type="button" onClick={onClose} aria-label="Close My needs" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{draft.map((need, index) => <article key={`${need}-${index}`} className="rounded-2xl border border-[#d8e5dd] bg-[#f8fbf9] p-3"><button type="button" onClick={() => onSpeak(need)} disabled={!need.trim()} className="min-h-14 w-full rounded-xl bg-white px-4 text-left text-base font-bold text-[#204d40] shadow-sm transition hover:bg-[#eaf8ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40">{need || "Untitled need"}</button><div className="mt-2 flex gap-2"><input aria-label={`Edit need ${index + 1}`} value={need} onChange={(event) => updateNeed(index, event.target.value)} maxLength={maxNeedLength} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#cddbd3] bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={() => removeNeed(index)} aria-label={`Remove ${need || "need"}`} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Remove</button></div></article>)}</div><div className="mt-5 border-t border-[#e1ebe5] pt-5"><label htmlFor="new-need" className="text-sm font-bold text-[#315a4b]">Add a phrase</label><div className="mt-2 flex gap-2"><input id="new-need" value={newNeed} onChange={(event) => setNewNeed(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNeed(); } }} maxLength={maxNeedLength} placeholder="For example: Please adjust my pillow" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={addNeed} disabled={!newNeed.trim() || draft.length >= 16} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Add</button></div></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={save} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save phrases</button></div></section></div>;
}

function ConversationSetup({ initialSettings, onClose, onChange, onSave }: { initialSettings: ConversationSettings; onClose: () => void; onChange: (settings: ConversationSettings) => void; onSave: (settings: ConversationSettings) => void }) {
  const [draft, setDraft] = useState(initialSettings);
  useEffect(() => { onChange(draft); }, [draft, onChange]);
  const updateDraft = (next: ConversationSettings) => setDraft(next);
  const updateList = (key: "peopleHere" | "topicsToAvoid" | "phrasesToAvoid", text: string) => updateDraft({ ...draft, [key]: text.split(",").map((item) => item.trim()).filter(Boolean) });
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="conversation-setup-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Your context</p><h2 id="conversation-setup-title" className="mt-2 text-2xl font-bold tracking-tight">Conversation setup</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Saved only in this browser. Cadence uses it to keep replies appropriate.</p></div><button type="button" onClick={onClose} aria-label="Close conversation setup" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-[#315a4b]">Setting<select value={draft.mode} onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as ConversationSettings["mode"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value="family">Family</option><option value="friends">Friends</option><option value="care">Care</option><option value="doctor">Doctor</option><option value="work">Work</option></select></label><label className="text-sm font-bold text-[#315a4b]">Energy<select value={draft.energy} onChange={(event) => setDraft((current) => ({ ...current, energy: event.target.value as ConversationSettings["energy"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value="low">Low: fewer choices</option><option value="normal">Normal</option><option value="good">Good</option></select></label><label className="text-sm font-bold text-[#315a4b]">Language<select value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value as ConversationSettings["language"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value="en-US">English (US)</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="hi-IN">हिन्दी</option></select></label></div><label className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-[#f1f7f3] px-3 text-sm font-bold text-[#315a4b]"><span>Keep my wording and language</span><input type="checkbox" checked={draft.preserveWording} onChange={(event) => setDraft((current) => ({ ...current, preserveWording: event.target.checked }))} className="h-5 w-5 accent-[#1f7a57]" /></label><p className="mt-2 text-xs leading-relaxed text-[#607a70]">Cadence will not translate or normalize your wording unless you ask it to.</p><label className="mt-4 block text-sm font-bold text-[#315a4b]">Who is here?<input value={draft.peopleHere.join(", ")} onChange={(event) => updateList("peopleHere", event.target.value)} maxLength={600} placeholder="Maya, Jon" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Topics to avoid<input value={draft.topicsToAvoid.join(", ")} onChange={(event) => updateList("topicsToAvoid", event.target.value)} maxLength={600} placeholder="prognosis, finances" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Phrases or humor to avoid<input value={draft.phrasesToAvoid.join(", ")} onChange={(event) => updateList("phrasesToAvoid", event.target.value)} maxLength={600} placeholder="no teasing about my voice" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Scan speed<select value={draft.scanIntervalMs} onChange={(event) => setDraft((current) => ({ ...current, scanIntervalMs: Number(event.target.value) }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value={900}>Fast</option><option value={1200}>Standard</option><option value={1800}>Slow</option></select><span className="mt-1 block text-xs font-normal text-[#607a70]">Bluetooth switches that send Space or Enter work with scanning.</span></label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => onSave(draft)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save setup</button></div></section></div>;
}

function ReplyPreviewDialog({ suggestion, isFavorite, previewEnabled, basedOn, onClose, onChange, onSpeak, onShorten, onMoreLikeMe, onPreviewChange, onReject, onFavorite, onWrongContext }: { suggestion: Suggestion; isFavorite: boolean; previewEnabled: boolean; basedOn: TranscriptTurn | null; onClose: () => void; onChange: (text: string) => void; onSpeak: () => void; onShorten: () => void; onMoreLikeMe: () => void; onPreviewChange: (enabled: boolean) => void; onReject: (reason: "not_me" | "never") => void; onFavorite: () => void; onWrongContext: (id: string) => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-3 sm:p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="reply-preview-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-[1.75rem] bg-white p-5 shadow-2xl sm:max-h-[90vh] sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Review before speaking</p><h2 id="reply-preview-title" className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Make it yours.</h2></div><button type="button" onClick={onClose} aria-label="Close reply preview" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#b8d4c4] text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div>{basedOn && <aside className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-[#d9e4dd] bg-[#f7fbf8] p-3" aria-label="Reply context"><div className="min-w-0"><p className="text-[0.7rem] font-bold uppercase tracking-wide text-[#527169]">Latest caption</p><p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-[#315a4b]"><span className="font-bold">{basedOn.speaker}:</span> {basedOn.text}</p></div><button type="button" onClick={() => onWrongContext(basedOn.id)} className="min-h-10 shrink-0 rounded-xl border border-[#d9aaa0] bg-white px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Wrong context</button></aside>}<textarea rows={2} value={suggestion.text} onChange={(event) => onChange(event.target.value)} maxLength={600} aria-label="Edit reply before speaking" className="mt-4 h-24 min-h-0 w-full resize-none rounded-2xl border border-[#bddac9] bg-[#fbfefb] p-4 text-base font-semibold leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:h-28 sm:text-lg" /><button type="button" onClick={onSpeak} className="mt-3 min-h-[52px] w-full rounded-2xl bg-[#1f7a57] px-5 text-base font-bold text-white shadow-sm hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Speak this</button><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={onShorten} className="min-h-11 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Shorter</button><button type="button" onClick={onMoreLikeMe} className="min-h-11 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">More like me</button><button type="button" onClick={onFavorite} className="min-h-11 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isFavorite ? "Unsave reply" : "Save reply"}</button><button type="button" onClick={() => onReject("not_me")} className="min-h-11 rounded-xl border border-[#e5c5bc] px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Not me</button></div><label className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[#f1f7f3] px-3 text-sm font-bold text-[#315a4b]"><span>Preview before speaking</span><input type="checkbox" checked={previewEnabled} onChange={(event) => onPreviewChange(event.target.checked)} className="h-5 w-5 shrink-0 accent-[#1f7a57]" /></label><button type="button" onClick={() => onReject("never")} className="mt-1 min-h-10 w-full rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Never suggest this again</button></section></div>;
}
function DebugLogDialog({ enabled, events, onClose, onEnabledChange, onClear, onExport }: { enabled: boolean; events: DebugEvent[]; onClose: () => void; onEnabledChange: (enabled: boolean) => void; onClear: () => void; onExport: () => void }) {
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="debug-title" className="mx-auto my-4 w-full max-w-3xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Testing only</p><h2 id="debug-title" className="mt-2 text-2xl font-bold tracking-tight">Debug session recording</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#607a70]">Optional and local-only. When enabled, this browser records transcript text, model inputs and outputs, selections, and speech results so you can inspect a test session. It is never sent to Cadence&apos;s server.</p></div><button type="button" onClick={onClose} aria-label="Close debug session recording" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f1f7f3] p-4"><div><p className="font-bold text-[#244b40]">Record this device</p><p className="mt-1 text-sm text-[#5d786e]">{enabled ? "Recording is on. Sensitive conversation content may be saved locally." : "Recording is off. No new events are saved."}</p></div><button type="button" onClick={() => onEnabledChange(!enabled)} aria-pressed={enabled} className={`min-h-12 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${enabled ? "bg-[#1f7a57] text-white" : "border border-[#9fceb3] bg-white text-[#1f7a57]"}`}>{enabled ? "Recording on" : "Start recording"}</button></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-bold text-[#315a4b]">{events.length} recorded {events.length === 1 ? "event" : "events"}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={onExport} disabled={!events.length} className="min-h-11 rounded-xl border border-[#9fceb3] px-3 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Export JSON</button><button type="button" onClick={onClear} disabled={!events.length} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd] disabled:opacity-50">Clear log</button></div></div><div className="mt-3 max-h-80 overflow-y-auto rounded-2xl border border-[#d9e4dd] bg-[#fbfdfb] p-3" aria-live="polite">{events.length ? <ol className="space-y-2">{[...events].reverse().map((event) => <li key={event.id} className="rounded-xl border border-[#e0e9e3] bg-white p-3"><p className="text-sm font-bold text-[#244b40]">{event.type}</p><time className="mt-1 block text-xs text-[#6d857c]">{new Date(event.at).toLocaleString()}</time>{event.data && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[#48645a]">{JSON.stringify(event.data, null, 2)}</pre>}</li>)}</ol> : <p className="p-3 text-sm text-[#6d857c]">Start recording, then use Cadence normally. Your local event trail will appear here.</p>}</div><button type="button" onClick={onClose} className="mt-6 min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></section></div>;
}

function MemoryDialog({ memory, onClose, onClear }: { memory: ConversationMemory; onClose: () => void; onClear: () => void }) {
  const hasMemory = memory.people.length > 0 || memory.topics.length > 0;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="memory-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Privacy-first memory</p><h2 id="memory-title" className="mt-2 text-2xl font-bold tracking-tight">What Cadence remembers</h2></div><button type="button" onClick={onClose} aria-label="Close memory" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-3 text-sm leading-relaxed text-[#4e6960]">This small memory stays only in this browser, on this device. It helps Cadence keep familiar people and topics in context. No separate server or model call builds it.</p><MemoryList title="People" items={memory.people} emptyLabel="No people remembered yet." /><MemoryList title="Topics" items={memory.topics} emptyLabel="No topics remembered yet." /><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClear} disabled={!hasMemory} className="min-h-12 rounded-xl border border-[#d9aaa0] px-4 font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd] disabled:cursor-not-allowed disabled:opacity-50">Clear memory</button><button type="button" autoFocus onClick={onClose} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div></section></div>;
}

function MemoryList({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return <section className="mt-5" aria-label={`Remembered ${title.toLowerCase()}`}><h3 className="text-sm font-bold text-[#315a4b]">{title}</h3>{items.length ? <ul className="mt-2 flex flex-wrap gap-2">{items.map((item) => <li key={item} className="rounded-full bg-[#edf5ef] px-3 py-1.5 text-sm font-semibold text-[#315a4b]">{item}</li>)}</ul> : <p className="mt-2 text-sm text-[#6b8178]">{emptyLabel}</p>}</section>;
}

function VoiceSetup({ initialStyleCard, hasLearnedStyle: initialHasLearnedStyle, onClose, onSave }: { initialStyleCard: string; hasLearnedStyle: boolean; onClose: () => void; onSave: (styleCard: string) => void }) {
  const [samples, setSamples] = useState("");
  const [styleCard, setStyleCard] = useState(initialStyleCard);
  const [hasResult, setHasResult] = useState(initialHasLearnedStyle);
  const [isEditing, setIsEditing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [error, setError] = useState("");
  const buildVoice = async () => { if (!samples.trim()) return; setIsBuilding(true); setError(""); try { const result = await conversationService.style({ samples }); setStyleCard(result.styleCard); setHasResult(true); onSave(result.styleCard); } catch (styleError) { setError(styleError instanceof Error ? styleError.message : "Unable to learn your voice."); } finally { setIsBuilding(false); } };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="voice-title" className="mx-auto my-6 w-full max-w-2xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Your voice</p><h2 id="voice-title" className="mt-2 text-3xl font-bold tracking-tight">Make Cadence sound like you.</h2></div><button type="button" onClick={onClose} aria-label="Close voice setup" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div>{!hasResult ? <><label htmlFor="voice-samples" className="mt-6 block text-sm font-bold text-[#315a4b]">Paste a handful of your real messages</label><p className="mt-1 text-sm leading-relaxed text-[#607a70]">Include the kinds of texts that sound most like you. Cadence learns tone, phrases, vocabulary, humor, and values.</p><textarea id="voice-samples" value={samples} onChange={(event) => setSamples(event.target.value)} className="mt-3 min-h-48 w-full rounded-2xl border border-[#b9d7c6] bg-[#fbfefb] p-4 text-base leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Paste messages here..." /><div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => void buildVoice()} disabled={isBuilding || !samples.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{isBuilding ? "Building..." : "Build my voice"}</button></div></> : <><label htmlFor="style-card" className="mt-6 block text-sm font-bold text-[#315a4b]">Your learned style card</label><textarea id="style-card" value={styleCard} onChange={(event) => setStyleCard(event.target.value)} readOnly={!isEditing} className="mt-3 min-h-40 w-full rounded-2xl border border-[#b9d7c6] bg-[#fbfefb] p-4 text-base leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd] read-only:text-[#36534d]" /><div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => { setHasResult(false); setIsEditing(false); }} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Re-learn</button><button type="button" onClick={() => setIsEditing((editing) => !editing)} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isEditing ? "Done editing" : "Edit card"}</button><button type="button" onClick={() => { onSave(styleCard); onClose(); }} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Use this voice</button></div></>}{error && <p className="mt-4 rounded-xl bg-[#fff0eb] px-4 py-3 text-sm font-semibold text-[#9a3c1b]" role="alert">{error}</p>}</section></div>;
}

function ProfileSetup({ initialProfile, onClose, onChange, onSave }: { initialProfile: PersonalProfile; onClose: () => void; onChange: (profile: PersonalProfile) => void; onSave: (profile: PersonalProfile) => void }) {
  const [draft, setDraft] = useState(initialProfile);
  useEffect(() => { onChange(draft); }, [draft, onChange]);
  const update = (key: keyof PersonalProfile, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="profile-title" className="mx-auto my-6 w-full max-w-2xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Personal details</p><h2 id="profile-title" className="mt-2 text-3xl font-bold tracking-tight">Help Cadence know you.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#607a70]">Saved only in this browser. Cadence uses these details only when they help answer what was just said.</p></div><button type="button" onClick={onClose} aria-label="Close personal details" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-[#315a4b]">Name you use<input value={draft.preferredName} onChange={(event) => update("preferredName", event.target.value)} maxLength={40} autoComplete="given-name" className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="For example: Sam" /></label><label className="text-sm font-bold text-[#315a4b]">Full name<input value={draft.fullName} onChange={(event) => update("fullName", event.target.value)} maxLength={80} autoComplete="name" className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Optional" /></label><label className="text-sm font-bold text-[#315a4b]">Pronouns<input value={draft.pronouns} onChange={(event) => update("pronouns", event.target.value)} maxLength={40} className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Optional" /></label><label className="text-sm font-bold text-[#315a4b] sm:col-span-2">A little about you<textarea value={draft.details} onChange={(event) => update("details", event.target.value)} maxLength={500} className="mt-2 min-h-28 w-full rounded-xl border border-[#b9d7c6] p-4 text-base font-normal leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Interests, people you mention often, work, or facts you want replies to draw on when relevant." /></label></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => onSave(draft)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save details</button></div></section></div>;
}
