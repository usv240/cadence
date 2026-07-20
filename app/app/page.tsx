"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribe, transcribeOnce, type BrowserTranscriber, type LiveTranscriptionStatus } from "@/lib/browser-transcribe";
import { candidatesToSuggestions, conversationService, RealModeConsentRequiredError, RequestTimeoutError } from "@/lib/conversation-service";
import { neutralStyleCard } from "@/lib/style-card";
import { AAC_TYPING_WORDS_PER_MINUTE, calculateReplyImpact, calculateSessionImpact } from "@/lib/impact";
import { emptyPersonalProfile, type PersonalProfile } from "@/lib/profile";
import { emptyConversationMemory, updateConversationMemory, type ConversationMemory } from "@/lib/memory";
import { defaultNeeds, sanitizeNeeds, maxNeedLength } from "@/lib/needs";
import { defaultFeelings, sanitizeFeelings, maxFeelingLength } from "@/lib/feelings";
import { appendDebugEvent, debugEnabledKey, debugLogKey, readDebugEvents, type DebugEvent } from "@/lib/debug-log";
import { emptyReplyPreferences, sanitizeReplyPreferences, type ReplyPreferences } from "@/lib/reply-preferences";
import { defaultConversationSettings, sanitizeConversationSettings, type ConversationSettings } from "@/lib/conversation-settings";
import { conversationKitsKey, sanitizeConversationKits, type ConversationKit } from "@/lib/conversation-kits";
import { applyPersonalVocabulary, formatPersonalVocabulary, parsePersonalVocabulary, personalVocabularyKey, sanitizePersonalVocabulary, type PersonalVocabularyEntry } from "@/lib/personal-vocabulary";
import { offlineExpand, offlineInitiate, offlinePredict, offlineToneAdjust } from "@/lib/offline-fallback";
import { defaultTtsVoice, isTtsVoice, ttsVoiceOptions, type TtsVoice } from "@/lib/voices";
import { localSessionKey, readLocalSession } from "@/lib/local-session";
import type { ParticipationEvent } from "@/lib/participation";
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
type Theme = "light" | "dark";
type SpeechOutput = "openai" | "device";
const floorHoldingPhrases = ["Give me a second, I'd like to respond.", "One moment — I want to add something.", "Hold on a moment, I have a thought."];

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
  const [showMore, setShowMore] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [showConversationSetup, setShowConversationSetup] = useState(false);
  const [showConversationKits, setShowConversationKits] = useState(false);
  const [showVocabulary, setShowVocabulary] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);
  const [showQuickControls, setShowQuickControls] = useState(false);
  const [showFeelingControls, setShowFeelingControls] = useState(false);
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
  const [styleCard, setStyleCard] = useState(neutralStyleCard);
  const [profile, setProfile] = useState<PersonalProfile>(emptyPersonalProfile);
  const [memory, setMemory] = useState<ConversationMemory>(emptyConversationMemory);
  const [needs, setNeeds] = useState<string[]>(defaultNeeds);
  const [feelings, setFeelings] = useState<string[]>(defaultFeelings);
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
  const styleCardRef = useRef(neutralStyleCard);
  const profileRef = useRef<PersonalProfile>(emptyPersonalProfile);
  const memoryRef = useRef<ConversationMemory>(emptyConversationMemory);
  const floorPhraseIndex = useRef(0);
  const debugEnabledRef = useRef(false);
  const debugEventsRef = useRef<DebugEvent[]>([]);
  const replyPreferencesRef = useRef<ReplyPreferences>(emptyReplyPreferences);
  const conversationSettingsRef = useRef<ConversationSettings>(defaultConversationSettings);
  const modalReturnFocus = useRef<HTMLElement | null>(null);

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
    setSelectedSuggestion(null);
    setShowVoicePicker(false);
    setShowSpoken(false);
  }, []);

  const hasOpenDialog = Boolean(showOnboarding || showFirstSpeechAffirmation || showVoiceSetup || showProfileSetup || showMemory || showBackupBoard || selectedTranscriptTurn || speakerTurn || showNeeds || showFeelings || showAbout || showPrivacy || tutorialStep !== null || showDebugLog || showConversationSetup || showConversationKits || showVocabulary || selectedSuggestion || showVoicePicker || showSpoken);

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
        const message = "Replies unavailable—use quick phrases or your saved replies.";
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
      (text, confidence) => {
        interimPredictionStarted.current = false;
        setListeningFeedback("Heard that — preparing replies.");
        appendPartnerTurn({ id: crypto.randomUUID(), speaker: "Room", text, time: currentTime(), color: "blue", confidence, isUncertain: typeof confidence === "number" && confidence < TRANSCRIPT_CONFIDENCE_THRESHOLD });
      },
      setListenStatus,
      setError,
      (text) => {
        const correctedText = applyPersonalVocabulary(text, personalVocabularyRef.current);
        setListeningFeedback(`Hearing: ${correctedText}`);
        const hasEnoughContext = correctedText.trim().split(/\s+/).length >= 3 || correctedText.trim().length >= 12;
        if (interimPredictionStarted.current || !hasEnoughContext) return;
        interimPredictionStarted.current = true;
        const context = [...transcriptRef.current.filter((turn) => !turn.isUncertain).map(({ speaker, text: turnText }) => ({ speaker, text: turnText })), { speaker: "Room", text: correctedText }].slice(-5);
        queueSpeculativePrediction(context, INTERIM_CAPTION_PREDICTION_DEBOUNCE_MS);
        recordDebugEvent("prediction_prefetched_interim", { text: correctedText });
      },
    );
    return () => liveTranscriber.current?.stop();
  }, [appendPartnerTurn, queueSpeculativePrediction, recordDebugEvent]);

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
    const savedTheme = window.localStorage.getItem("cadence.theme");
    const nextTheme: Theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    setTheme(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    window.localStorage.setItem("cadence.theme", nextTheme);
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
    const nextKit: ConversationKit = { id: crypto.randomUUID(), name: cleanedName, settings: { ...conversationSettingsRef.current, privateSession: false } };
    const nextKits = sanitizeConversationKits([...conversationKits.filter((kit) => kit.name.localeCompare(cleanedName, undefined, { sensitivity: "accent" }) !== 0), nextKit]);
    window.localStorage.setItem(conversationKitsKey, JSON.stringify(nextKits));
    setConversationKits(nextKits);
    recordDebugEvent("conversation_kit_saved", { name: cleanedName });
  }, [conversationKits, recordDebugEvent]);

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
  const highlightedTargetId = isScanningMode ? scanTargets[scanIndex]?.id : undefined;

  const selectScannedTarget = useCallback(() => {
    const target = scanTargets[scanIndex];
    if (!target) return;
    recordDebugEvent("scan_target_selected", { id: target.id, label: target.label });
    target.select();
    setScanIndex(0);
  }, [recordDebugEvent, scanIndex, scanTargets]);

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
    if (!isScanningMode) return;
    const selectWithSingleSwitch = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      selectScannedTarget();
    };
    window.addEventListener("keydown", selectWithSingleSwitch);
    return () => window.removeEventListener("keydown", selectWithSingleSwitch);
  }, [isScanningMode, selectScannedTarget]);

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

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-3 py-3 pb-24 text-[#122726] sm:px-6 sm:py-6 sm:pb-28 lg:px-10 lg:py-8">
      <a href="#replies" className="skip-link">Skip to reply cards</a>
      {isScanningMode && <p className="sr-only" aria-live="assertive" aria-atomic="true">Scanning {scanTargets[scanIndex]?.label}. Target {scanIndex + 1} of {scanTargets.length}. Press Space or Enter to select.</p>}
      {isScanningMode && <div className="fixed bottom-20 left-3 z-40 sm:bottom-4 sm:left-4"><button type="button" onClick={selectScannedTarget} className="min-h-14 rounded-2xl bg-[#f7d341] px-5 text-base font-black text-[#102823] shadow-xl ring-4 ring-[#102823] ring-offset-2 ring-offset-[#f5f7f4] transition hover:bg-[#ffe36b] focus:outline-none focus:ring-4 focus:ring-[#102823]">Select highlighted</button></div>}
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-2 sm:bottom-4 sm:left-4"><button type="button" onClick={() => { recordDebugEvent("needs_opened"); setShowNeeds(true); }} aria-haspopup="dialog" className={`min-h-12 rounded-full bg-[#305a4e] px-4 text-sm font-bold text-white shadow-xl transition hover:bg-[#23493e] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14 sm:px-5 sm:text-base ${highlightedTargetId === "open-needs" ? "scale-105 bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4]" : ""}`}>My needs</button>{transcript.at(-1)?.isUncertain && <button type="button" onClick={() => setSelectedTranscriptTurn(transcript.at(-1) ?? null)} aria-label="Review uncertain caption" className="min-h-12 rounded-full bg-[#f7d341] px-3 text-sm font-black text-[#102823] shadow-lg focus:outline-none focus:ring-4 focus:ring-[#173d3a] sm:min-h-14">Fix caption</button>}<button type="button" onClick={() => setShowBackupBoard(true)} aria-haspopup="dialog" aria-label="Open offline backup board" className="grid min-h-12 min-w-12 place-items-center rounded-full border border-[#b9d4c5] bg-white px-3 text-sm font-black text-[#305a4e] shadow-lg hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14">▦</button></div>
      <div className="fixed bottom-3 right-3 z-40 flex items-center gap-2" aria-live="polite">{isSpeaking && <><span className="hidden rounded-full bg-[#102823] px-3 py-2 text-xs font-bold text-white shadow-lg sm:inline">{speechStatus === "preparing" ? "Getting voice ready…" : "Speaking…"}</span><button type="button" onClick={stopSpeaking} aria-label="Stop speaking audio" className="min-h-12 rounded-full border border-[#b9cfc2] bg-white px-3 text-sm font-bold text-[#315a4b] shadow-lg hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14">Stop</button></>}<button type="button" onClick={holdTheFloor} aria-label="Hold the floor and speak a response placeholder" disabled={isSpeaking} className={`min-h-12 rounded-full bg-[#1f7a57] px-4 text-sm font-bold text-white shadow-xl transition hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:cursor-wait disabled:opacity-70 sm:min-h-14 sm:px-5 sm:text-base ${highlightedTargetId === "hold-floor" ? "scale-105 bg-[#f7d341] text-[#102823] ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4]" : ""}`}>{isSpeaking ? "Speaking…" : "Hold the floor"}</button></div>
      {showOnboarding && <Onboarding onStart={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); }} onTour={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setTutorialStep(0); }} onSetupVoice={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowVoiceSetup(true); }} onSetupProfile={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowProfileSetup(true); }} />}
      {showFirstSpeechAffirmation && <FirstSpeechAffirmation onDismiss={() => setShowFirstSpeechAffirmation(false)} />}
      {showVoiceSetup && <VoiceSetup initialStyleCard={styleCard} hasLearnedStyle={hasLearnedStyle} onClose={() => setShowVoiceSetup(false)} onSave={(nextStyleCard) => { styleCardRef.current = nextStyleCard; window.localStorage.setItem("cadence.styleCard", nextStyleCard); setStyleCard(nextStyleCard); setHasLearnedStyle(true); recordDebugEvent("voice_style_saved", { styleCard: nextStyleCard }); }} />}
      {showProfileSetup && <ProfileSetup initialProfile={profile} onClose={() => setShowProfileSetup(false)} onChange={persistProfile} onSave={(nextProfile) => { persistProfile(nextProfile); setShowProfileSetup(false); recordDebugEvent("personal_details_saved", { profile: nextProfile }); refreshPredictions(transcriptForModel()); }} />}
      {showConversationSetup && <ConversationSetup initialSettings={conversationSettings} onClose={() => setShowConversationSetup(false)} onChange={persistConversationSettings} onSave={(settings) => { saveConversationSettings(settings); setShowConversationSetup(false); }} />}
      {showConversationKits && <ConversationKitsDialog kits={conversationKits} settings={conversationSettings} onApply={(settings) => { saveConversationSettings({ ...settings, privateSession: false }); setShowConversationKits(false); }} onClose={() => setShowConversationKits(false)} onDelete={deleteConversationKit} onSave={saveConversationKit} />}
      {showVocabulary && <PersonalVocabularyDialog vocabulary={personalVocabulary} userName={profile.preferredName} onClose={() => setShowVocabulary(false)} onSave={savePersonalVocabulary} />}
      {showPrivacy && <PrivacyDialog hasRealModeConsent={hasRealModeConsent} onClose={() => setShowPrivacy(false)} onConsent={grantRealModeConsent} onErase={eraseLocalData} />}
      {showVoicePicker && <VoicePicker selectedVoice={ttsVoice} isPreviewing={isPreviewingVoice} onClose={() => setShowVoicePicker(false)} onPreview={previewTtsVoice} onSelect={selectTtsVoice} />}
      {showMemory && <MemoryDialog memory={memory} onClose={() => setShowMemory(false)} onClear={() => { memoryRef.current = emptyConversationMemory; window.localStorage.setItem("cadence.memory", JSON.stringify(emptyConversationMemory)); setMemory(emptyConversationMemory); }} />}
      {showBackupBoard && <BackupBoardDialog needs={needs} feelings={feelings} favorites={replyPreferences.favorites} profile={profile} onClose={() => setShowBackupBoard(false)} onSpeak={(text) => void addSpoken(text, undefined, undefined, "backup_board")} />}
      {selectedTranscriptTurn && <TranscriptRepairDialog turn={selectedTranscriptTurn} onClose={() => setSelectedTranscriptTurn(null)} onConfirm={confirmTranscriptTurn} />}
      {speakerTurn && <SpeakerNameDialog turn={speakerTurn} suggestions={Array.from(new Set([...conversationSettings.peopleHere, ...memory.people, ...personalVocabulary.map((entry) => entry.writeAs)]))} onClose={() => setSpeakerTurn(null)} onSave={renameTranscriptSpeaker} />}
      {showNeeds && <NeedsDialog needs={needs} onClose={() => setShowNeeds(false)} onSpeak={speakNeed} onSave={saveNeeds} />}
      {showFeelings && <FeelingsDialog feelings={feelings} onClose={() => setShowFeelings(false)} onSpeak={speakFeeling} onSave={saveFeelings} />}
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

      <div className="mx-auto max-w-[1440px]">
        <header className="relative flex items-center justify-between gap-2 border-b border-[#dbe5de] pb-3 sm:gap-3 sm:pb-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173d3a] text-base font-bold text-white sm:h-11 sm:w-11 sm:rounded-2xl sm:text-lg" aria-hidden="true">C</div><div className="min-w-0"><p className="text-lg font-bold tracking-tight sm:text-xl">Cadence</p><p className="truncate text-xs font-medium text-[#60766e] sm:text-sm">{isDemoPlaying ? "Dinner at Maya's" : "Live conversation"} <span className="mx-1 text-[#a9bbb1]">/</span> {isDemoPlaying ? "Demo" : "Ready"}</p></div></div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={toggleListening} aria-pressed={listenStatus === "listening"} aria-label={listenStatus === "listening" ? "Turn listening off" : "Turn listening on"} className={`listen-toggle flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${listenStatus === "listening" ? "listen-toggle-on" : "listen-toggle-off"}`}><span className={`listen-indicator h-2.5 w-2.5 rounded-full ${listenStatus === "listening" ? "animate-pulse" : ""}`} />{listenStatus === "listening" ? "Listening" : listenStatus === "unsupported" ? "Listen unavailable" : "Listen"}</button>
            <div className="relative">
              <button type="button" onClick={() => setShowMore((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") setShowMore(false); }} aria-expanded={showMore} aria-controls="more-menu" className="min-h-12 rounded-full border border-[#cdd9d2] bg-white px-4 text-sm font-bold text-[#315a4b] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">More</button>
              {showMore && <div id="more-menu" role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-[#d6e1da] bg-white p-2 shadow-xl">
                <button type="button" role="menuitem" onClick={() => { setShowVoicePicker(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">OpenAI voice: {ttsVoice}</button>
                <button type="button" role="menuitem" onClick={() => { selectSpeechOutput(speechOutput === "device" ? "openai" : "device"); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{speechOutput === "device" ? "Use OpenAI voice (quality)" : "Use instant device voice"}</button>
                <button type="button" role="menuitem" onClick={() => { setShowVoiceSetup(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Your voice</button>
                <button type="button" role="menuitem" onClick={() => { setShowProfileSetup(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Personal details</button>
                <button type="button" role="menuitem" onClick={() => { setShowVocabulary(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Words Cadence should recognize</button>
                <button type="button" role="menuitem" onClick={() => { setShowConversationKits(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Conversation kits</button>
                <button type="button" role="menuitem" onClick={() => { setShowMemory(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">What Cadence remembers</button>
                <button type="button" role="menuitem" onClick={() => { setShowDebugLog(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Debug session recording</button>
                <button type="button" role="menuitem" onClick={() => { toggleScanningMode(); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isScanningMode ? "Turn scanning off" : "Scanning mode"}</button>
                <button type="button" role="menuitem" onClick={() => { if (isDemoPlaying) setIsDemoPlaying(false); else playDemo(); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isDemoPlaying ? "Stop demo conversation" : "Play demo conversation"}</button>
                <button type="button" role="menuitem" onClick={() => { clearLocalSession(); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Clear this session</button>
                <button type="button" role="menuitem" onClick={() => { setShowAbout(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">About</button>
              </div>}
            </div>
          </div>
        </header>

        <div className="mt-2 flex justify-end">
          <div className="flex flex-wrap items-center justify-end gap-1">
            <button type="button" onClick={() => saveConversationSettings({ ...conversationSettingsRef.current, privateSession: !conversationSettingsRef.current.privateSession })} aria-pressed={conversationSettings.privateSession} className={`min-h-10 rounded-xl px-3 text-xs font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${conversationSettings.privateSession ? "bg-[#173d3a] text-white" : "text-[#315a4b] hover:bg-[#edf5ef]"}`}>{conversationSettings.privateSession ? "Private session on" : "Private session"}</button>
            <button type="button" onClick={() => setShowPrivacy(true)} className="min-h-10 rounded-xl px-3 text-xs font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Privacy</button>
            <button type="button" onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="min-h-10 rounded-xl px-3 text-xs font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{theme === "dark" ? "Light mode" : "Dark mode"}</button>
          </div>
        </div>
        {conversationSettings.privateSession && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#b9d7c6] bg-[#edf7f1] px-4 py-3 text-sm text-[#315a4b]" role="status"><p><span className="font-black">Private session is on.</span> Cadence will not save new captions, replies, memory, or debug events on this device.</p><button type="button" onClick={() => saveConversationSettings({ ...conversationSettingsRef.current, privateSession: false })} className="min-h-10 rounded-xl border border-[#9fceb3] bg-white px-3 text-xs font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">End private session</button></div>}
        {!isOnline && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fff3e6] px-4 py-3 text-sm font-semibold text-[#80511c]" role="status"><p><span className="font-black">Offline mode.</span> Your local replies, quick phrases, needs, and device speech are ready.</p><button type="button" onClick={() => setShowBackupBoard(true)} className="min-h-11 rounded-xl border border-[#d69a4d] bg-white px-3 text-sm font-bold text-[#80511c] hover:bg-[#fff8ee] focus:outline-none focus:ring-4 focus:ring-[#f2c98d]">Open essentials</button></div>}
        <div className="mt-4 grid gap-5 sm:mt-6 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0" aria-label="Communication companion">
            <section className="rounded-2xl border border-[#dce6df] bg-white p-3 sm:rounded-3xl sm:p-5" aria-labelledby="transcript-heading"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">Room transcript</p><h2 id="transcript-heading" className="mt-0.5 text-base font-bold sm:mt-1 sm:text-lg">What&apos;s being said</h2></div><span className="rounded-full bg-[#f1f5f2] px-2.5 py-1 text-[11px] font-bold text-[#54706b] sm:px-3 sm:py-1.5 sm:text-xs" role="status">{listenStatus === "listening" ? "Listening" : isDemoPlaying ? "Demo playing" : "Ready"}</span></div>{listenStatus === "listening" && listeningFeedback && <p className="mt-2 truncate text-xs font-semibold text-[#176746]" role="status">{listeningFeedback}</p>}{transcript.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-[#4b675e]">Turn on Listen when people begin talking. Cadence will prepare replies from the conversation.</p> : <><div className="mt-2 flex items-center justify-between gap-2 sm:hidden"><p className="truncate text-sm text-[#4b675e]"><span className="font-bold text-[#294841]">{transcript.at(-1)?.speaker}:</span> {transcript.at(-1)?.text}</p><button type="button" onClick={() => setSpeakerTurn(transcript.at(-1) ?? null)} className="min-h-10 shrink-0 rounded-xl px-2 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Who said this?</button></div><div className="mt-3 hidden max-h-44 space-y-2 overflow-y-auto pr-1 sm:block" aria-live="polite" aria-relevant="additions">{transcript.map((turn, index) => <TranscriptLine key={turn.id} turn={turn} isLatest={index === transcript.length - 1} onName={() => setSpeakerTurn(turn)} />)}<div ref={transcriptEnd} /></div></>}</section>

            <section id="replies" className="mt-4 scroll-mt-4 sm:mt-8" aria-labelledby="replies-heading"><div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">{suggestionMode === "initiate" ? "Your opening" : "Your next thought"}</p><h1 id="replies-heading" className="mt-0.5 text-xl font-bold tracking-tight sm:mt-1 sm:text-3xl">{suggestionMode === "initiate" ? "Start the conversation" : suggestions.length ? "Choose a reply" : "Ready when you are"}</h1><p className="mt-0.5 text-sm text-[#54706b] sm:mt-1 sm:text-base">{suggestionMode === "initiate" ? "Tap an opener to speak it." : suggestions.length ? "Tap a reply to speak it." : "Listen to the room, or start something yourself."}</p></div><div className="flex flex-wrap items-center gap-1 sm:gap-2"><button type="button" onClick={() => void startSomething()} disabled={isInitiating} className="min-h-10 rounded-xl bg-[#1f7a57] px-2.5 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 sm:min-h-11 sm:px-3">{isInitiating ? "Starting" : "Start something"}</button><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-xs ${predictionStatus === "ready" ? "bg-[#e3f4eb] text-[#176746]" : "bg-[#f1f5f2] text-[#54706b]"}`} role="status">{predictionStatus === "ready" ? "Ready" : "Preparing replies…"}</span><button type="button" onClick={() => refreshPredictions(transcriptForModel())} disabled={isRefreshing || transcript.length === 0} className="min-h-10 rounded-xl px-2.5 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 sm:min-h-11 sm:px-3">{isRefreshing ? "Preparing…" : "Refresh"}</button></div></div>{predictionStatus === "preparing" && <p className="mt-2 text-xs font-semibold text-[#54706b]" role="status">Keeping your current replies ready while Cadence prepares the next set.</p>}{isScanningMode && <p className="mt-3 rounded-2xl bg-[#102823] px-4 py-3 text-sm font-bold text-white" role="status">Scanning is on. Press Space or Enter to speak the highlighted choice.</p>}<div className={`mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 xl:grid-cols-4 ${predictionStatus === "ready" ? "motion-safe:animate-[pulse_0.55s_ease-out_1]" : ""}`}>{suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} onSpeak={addSpoken} disabled={isSpeaking} isScanningHighlighted={highlightedTargetId === `suggestion-${suggestion.id}`} />)}</div>{!suggestions.length && <p className="mt-4 rounded-2xl border border-dashed border-[#d5e0d9] bg-white px-4 py-4 text-sm leading-relaxed text-[#54706b]">When someone speaks, Cadence will stage replies here. You can also choose <span className="font-bold text-[#315a4b]">Start something</span> to open the conversation in your own words.</p>}{error && <p className="mt-4 rounded-xl bg-[#fff0eb] px-4 py-3 text-sm font-semibold text-[#9a3c1b]" role="alert">{error}</p>}</section>

            {contextUndo && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e5c5bc] bg-[#fff7f3] px-4 py-3 text-sm text-[#7f3b24]" role="status"><p>Caption removed from reply context.</p><button type="button" onClick={restoreTranscriptContext} className="min-h-10 rounded-xl border border-[#d9aaa0] bg-white px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Undo</button></div>}
            <section className="mt-5 rounded-3xl border border-[#dce6df] bg-white p-4 sm:mt-7 sm:p-5" aria-label="More ways to respond">
              <button type="button" onClick={() => setShowQuickControls((open) => !open)} aria-expanded={showQuickControls} aria-controls="quick-controls" className="flex min-h-12 w-full items-center justify-between text-left text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] lg:hidden"><span>More ways to respond</span><span aria-hidden="true">{showQuickControls ? "−" : "+"}</span></button>
              <div className="mt-2 flex justify-end lg:hidden"><InfoTip label="More ways to respond">Open this for short reactions, feelings, tone, and either generated or exact words. It stays closed until you need it.</InfoTip></div>
              <div id="quick-controls" className={`${showQuickControls ? "block" : "hidden"} lg:block`}>
                <button type="button" onClick={() => setShowConversationSetup(true)} className="mb-4 flex min-h-11 w-full items-center justify-between rounded-xl border-b border-[#e1ebe5] px-1 pb-3 text-left text-sm font-bold text-[#315a4b] hover:text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]"><span>{conversationSettings.mode} · {conversationSettings.energy} energy</span><span>Set up</span></button>
                <div className="grid gap-5 pt-4 lg:grid-cols-[1fr_1fr_auto] lg:items-start">
                  <div><p className="text-sm font-bold text-[#3e5d53]">Quick reactions</p><div className="mt-3 flex flex-wrap gap-2">{quickReplies.map((reply) => <QuickButton key={reply} text={reply} onClick={addSpoken} isScanningHighlighted={highlightedTargetId === `reaction-${reply}`} />)}{intents.map((intent) => <QuickButton key={intent} text={intent} onClick={addSpoken} />)}</div></div>
                  <div><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => setShowFeelingControls((open) => !open)} aria-expanded={showFeelingControls} className="min-h-11 rounded-xl px-1 text-sm font-bold text-[#3e5d53] hover:text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Feelings {showFeelingControls ? "−" : "+"}</button><button type="button" onClick={() => setShowFeelings(true)} className="min-h-10 rounded-xl px-2 text-xs font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Edit</button></div>{showFeelingControls && <div className="mt-3 flex flex-wrap gap-2">{feelings.map((feeling, index) => <QuickButton key={feeling} text={feeling} onClick={speakFeeling} isScanningHighlighted={highlightedTargetId === `feeling-${index}`} />)}</div>}</div>
                  <fieldset className="shrink-0"><legend className="text-sm font-bold text-[#3e5d53]">Tone</legend><div className="mt-3 flex gap-2">{tones.map((option) => <button key={option} type="button" onClick={() => void selectTone(option)} disabled={isRefreshing} aria-pressed={tone === option} className={`min-h-11 rounded-xl border px-4 text-sm font-bold capitalize transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 ${tone === option ? "border-[#1f7a57] bg-[#1f7a57] text-white" : "border-[#d5e0d9] bg-white text-[#416158] hover:bg-[#edf5ef]"}`}>{option}</button>)}</div></fieldset>
                </div>
                <div className="mt-5 border-t border-[#e3ebe6] pt-4"><div className="flex gap-2" role="tablist" aria-label="Choose response action"><button type="button" role="tab" aria-selected={composerMode === "generate"} onClick={() => setComposerMode("generate")} className={`min-h-11 rounded-xl px-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${composerMode === "generate" ? "bg-[#1f7a57] text-white" : "bg-[#edf5ef] text-[#315a4b]"}`}>Make replies</button><button type="button" role="tab" aria-selected={composerMode === "speak"} onClick={() => setComposerMode("speak")} className={`min-h-11 rounded-xl px-3 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${composerMode === "speak" ? "bg-[#1f7a57] text-white" : "bg-[#edf5ef] text-[#315a4b]"}`}>Speak exactly</button></div>{composerMode === "generate" ? <form className="mt-3" onSubmit={handleExpand}><label htmlFor="keyword" className="text-sm font-bold text-[#3e5d53]">Start with a word or short idea</label><p className="mt-1 text-xs text-[#607a70]">Type it, or say a few words and Cadence will make full replies.</p><div className="mt-2 flex flex-wrap gap-2"><input id="keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={40} placeholder="For example: picnic" className="min-h-12 min-w-0 basis-full rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd] sm:basis-auto sm:flex-1" /><button type="button" onClick={startVoiceSteer} aria-pressed={isVoiceSteering} aria-label={isVoiceSteering ? "Stop listening for your idea" : "Speak a short idea to make replies"} className={`min-h-12 rounded-xl px-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${isVoiceSteering ? "bg-[#173d3a] text-white" : "border border-[#9fceb3] bg-white text-[#1f7a57] hover:bg-[#edf5ef]"}`}>{isVoiceSteering ? "Listening…" : "Speak idea"}</button><button type="submit" disabled={isExpanding || !keyword.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{isExpanding ? "Thinking" : "Make"}</button></div><p className="sr-only" role="status" aria-live="polite">{isVoiceSteering ? "Listening for a short idea." : ""}</p></form> : <form className="mt-3" onSubmit={handleCustomSpeak}><label htmlFor="custom-message" className="text-sm font-bold text-[#3e5d53]">Speak your own words</label><div className="mt-2 flex gap-2"><input id="custom-message" value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} maxLength={600} placeholder="Type exactly what you want to say" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={!customMessage.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Speak</button></div></form>}</div>
              </div>
            </section>
          </section>

          <aside className="rounded-3xl border border-[#dce6df] bg-white p-4 xl:self-start xl:p-5" aria-label="Your spoken log"><div className="flex items-center justify-between"><div><p className="eyebrow">Your voice</p><h2 className="mt-1 text-xl font-bold tracking-tight xl:text-2xl">Spoken</h2></div><button type="button" onClick={() => setShowSpoken((open) => !open)} aria-expanded={showSpoken} aria-controls="spoken-log" className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] xl:hidden">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} {showSpoken ? "−" : "+"}</button><span className="hidden h-10 w-10 place-items-center rounded-full bg-[#edf5ef] text-[#1f7a57] xl:grid" aria-hidden="true">~</span></div><div id="spoken-log" className={`${showSpoken ? "block" : "hidden"} xl:block`}><p className="mt-3 text-xs font-semibold leading-relaxed text-[#5b786a]">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} · ~{sessionImpact.tapsUsed} {sessionImpact.tapsUsed === 1 ? "tap" : "taps"} · ~{(sessionImpact.secondsSaved / 60).toFixed(1)} min saved · ~{sessionImpact.speedup.toFixed(1)}x faster</p><p className="mt-1 text-xs text-[#789087]">Based on {AAC_TYPING_WORDS_PER_MINUTE} words/min typing.</p><div className="mt-5 space-y-3" aria-live="polite">{spoken.length ? spoken.map((item) => <div key={item.id} className="rounded-2xl bg-[#f1f7f3] p-4"><p className="text-base font-semibold leading-relaxed">{item.text}</p><p className="mt-2 text-xs font-bold uppercase tracking-wider text-[#5d8371]">1 tap · ~{Math.round(item.impact.secondsSaved)}s saved</p></div>) : <div className="rounded-2xl border border-dashed border-[#d0ddd5] bg-[#fafcfb] p-5 text-sm leading-relaxed text-[#5c746d]">Your selected replies appear here.</div>}</div></div></aside>
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

function ConversationKitsDialog({ kits, settings, onApply, onClose, onDelete, onSave }: { kits: ConversationKit[]; settings: ConversationSettings; onApply: (settings: ConversationSettings) => void; onClose: () => void; onDelete: (id: string) => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  const save = () => { if (!name.trim()) return; onSave(name); setName(""); };
  return <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="conversation-kits-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Local contexts</p><h2 id="conversation-kits-title" className="mt-2 text-2xl font-bold tracking-tight">Conversation kits</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Save a context you use often—such as family dinner, a doctor visit, or work—then restore its people, boundaries, and energy with one tap.</p></div><button type="button" onClick={onClose} aria-label="Close conversation kits" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><form className="mt-6 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); save(); }}><label className="sr-only" htmlFor="conversation-kit-name">Name this conversation kit</label><input id="conversation-kit-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={`Save current ${settings.mode} setup as…`} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={!name.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Save kit</button></form><div className="mt-5 space-y-3">{kits.length ? kits.map((kit) => <article key={kit.id} className="rounded-2xl border border-[#d9e4dd] bg-[#fbfdfb] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-[#244b40]">{kit.name}</h3><p className="mt-1 text-sm text-[#607a70]">{kit.settings.mode} · {kit.settings.energy} energy{kit.settings.peopleHere.length ? ` · ${kit.settings.peopleHere.join(", ")}` : ""}</p></div><div className="flex gap-2"><button type="button" onClick={() => onDelete(kit.id)} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Delete</button><button type="button" onClick={() => onApply(kit.settings)} className="min-h-11 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Use kit</button></div></div></article>) : <p className="rounded-2xl border border-dashed border-[#d5e0d9] p-4 text-sm leading-relaxed text-[#607a70]">No kits yet. Set up a conversation, then save it here for next time.</p>}</div><button type="button" onClick={onClose} className="mt-6 min-h-12 rounded-xl border border-[#9fceb3] px-5 font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></section></div>;
}

function SuggestionCard({ suggestion, onSpeak, disabled = false, isScanningHighlighted = false }: { suggestion: Suggestion; onSpeak: (text: string) => Promise<void>; disabled?: boolean; isScanningHighlighted?: boolean }) { const styles = { mint: "reply-card-mint", peach: "reply-card-peach", sky: "reply-card-sky", lilac: "reply-card-lilac" }; return <button type="button" onClick={() => void onSpeak(suggestion.text)} disabled={disabled} aria-label={disabled ? "Cadence is speaking. Stop audio before choosing another reply." : `Speak ${suggestion.label} reply: ${suggestion.text}`} aria-current={isScanningHighlighted || undefined} className={`reply-card group min-h-28 rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#2b7a5b] disabled:cursor-wait disabled:opacity-60 sm:min-h-48 sm:rounded-3xl sm:p-5 ${styles[suggestion.accent]} ${isScanningHighlighted ? "scale-[1.02] bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4] shadow-2xl" : ""}`}><span className="reply-intent rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider sm:py-1 sm:text-xs">{suggestion.label}</span><p className="mt-2 text-sm font-semibold leading-snug sm:mt-4 sm:text-lg sm:leading-relaxed">{suggestion.text}</p><span className="reply-speak mt-2 inline-flex items-center gap-1 text-xs font-bold sm:mt-4 sm:text-sm" aria-hidden="true">{disabled ? "Speaking…" : "Speak"}</span></button>; }

function QuickButton({ text, spokenText = text, onClick, isScanningHighlighted = false }: { text: string; spokenText?: string; onClick: (text: string) => Promise<void>; isScanningHighlighted?: boolean }) { return <button type="button" onClick={() => void onClick(spokenText)} aria-label={`Speak ${spokenText}`} aria-current={isScanningHighlighted || undefined} className={`min-h-11 rounded-xl border border-[#d5e0d9] bg-white px-4 text-sm font-bold text-[#416158] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${isScanningHighlighted ? "scale-105 bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-white shadow-lg" : ""}`}>{text}</button>; }

function Onboarding({ onStart, onTour, onSetupVoice, onSetupProfile }: { onStart: () => void; onTour: () => void; onSetupVoice: () => void; onSetupProfile: () => void }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><p className="eyebrow">Welcome to Cadence</p><h2 id="welcome-title" className="mt-2 text-3xl font-bold tracking-tight">You&apos;re ready to join in.</h2><p className="mt-3 leading-relaxed text-[#4e6960]">No training needed - when people talk, your replies get ready. Tap one to speak.</p><button type="button" autoFocus onClick={onStart} className="mt-6 min-h-14 w-full rounded-2xl bg-[#1f7a57] px-5 text-base font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Start</button><div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-bold"><button type="button" onClick={onTour} className="min-h-11 rounded-xl px-2 text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Show me how</button><button type="button" onClick={onSetupVoice} className="min-h-11 rounded-xl px-2 text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Set up my voice <span className="font-medium">(optional)</span></button><button type="button" onClick={onSetupProfile} className="min-h-11 rounded-xl px-2 text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Add my details <span className="font-medium">(optional)</span></button></div></section></div>; }

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
];

function TutorialDialog({ step, onClose, onStepChange }: { step: number; onClose: () => void; onStepChange: (step: number) => void }) {
  const current = tutorialSteps[step];
  const isLast = step === tutorialSteps.length - 1;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-description" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><p className="eyebrow">Quick tour · {step + 1} of {tutorialSteps.length}</p><button type="button" onClick={onClose} aria-label="Close tutorial" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><h2 id="tutorial-title" className="mt-4 text-3xl font-bold tracking-tight">{current.title}</h2><p id="tutorial-description" className="mt-3 text-base leading-relaxed text-[#4e6960]">{current.text}</p><div className="mt-7 flex items-center justify-between gap-3"><button type="button" onClick={() => onStepChange(Math.max(0, step - 1))} disabled={step === 0} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40">Back</button><button type="button" onClick={() => isLast ? onClose() : onStepChange(step + 1)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isLast ? "Start using Cadence" : "Next"}</button></div></section></div>;
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
      `Cadence communication plan — ${name}`,
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

function AboutDialog({ isOnline, listenStatus, hasRealModeConsent, onClose, onTour }: { isOnline: boolean; listenStatus: LiveTranscriptionStatus; hasRealModeConsent: boolean; onClose: () => void; onTour: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="about-title" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">About Cadence</p><h2 id="about-title" className="mt-2 text-2xl font-bold tracking-tight">Stay in the conversation.</h2></div><button type="button" onClick={onClose} aria-label="Close about" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-4 leading-relaxed text-[#4e6960]">Cadence listens to complete room turns and prepares replies in your voice, so a thought can be spoken with one tap. Listen uses browser speech recognition when available.</p><div className="mt-4 rounded-2xl bg-[#f1f7f3] p-4 text-sm"><p className="font-bold text-[#315a4b]">System status</p><p className="mt-2 text-[#4e6960]">Connection: <strong>{isOnline ? "Online" : "Offline — local tools ready"}</strong> · Captions: <strong>{listenStatus === "listening" ? "Listening" : listenStatus === "unsupported" ? "Unavailable" : "Ready"}</strong> · Online AI permission: <strong>{hasRealModeConsent ? "Allowed" : "Not enabled"}</strong></p><p className="mt-3 text-xs text-[#607a70]">Built with Next.js, React, TypeScript, Tailwind CSS, browser speech recognition, optional OpenAI replies and speech, local device storage, and Vercel.</p></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onTour} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 font-bold text-[#1f7a57] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Take the tour</button><button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div></section></div>;
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

function NeedsDialog({ needs, onClose, onSpeak, onSave }: { needs: string[]; onClose: () => void; onSpeak: (text: string) => void; onSave: (needs: string[]) => void }) {
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
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="needs-title" className="mx-auto my-4 w-full max-w-2xl rounded-[2rem] bg-white p-5 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Quick communication</p><h2 id="needs-title" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">My needs</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#607a70]">Choose a phrase to speak it clearly. These phrases stay in this browser and can be tailored for you.</p></div><button type="button" onClick={onClose} aria-label="Close My needs" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{draft.map((need, index) => <article key={`${need}-${index}`} className="rounded-2xl border border-[#d8e5dd] bg-[#f8fbf9] p-3"><button type="button" onClick={() => onSpeak(need)} disabled={!need.trim()} className="min-h-14 w-full rounded-xl bg-white px-4 text-left text-base font-bold text-[#204d40] shadow-sm transition hover:bg-[#eaf8ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-40">{need || "Untitled need"}</button><div className="mt-2 flex gap-2"><input aria-label={`Edit need ${index + 1}`} value={need} onChange={(event) => updateNeed(index, event.target.value)} maxLength={maxNeedLength} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#cddbd3] bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={() => removeNeed(index)} aria-label={`Remove ${need || "need"}`} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Remove</button></div></article>)}</div><div className="mt-5 border-t border-[#e1ebe5] pt-5"><label htmlFor="new-need" className="text-sm font-bold text-[#315a4b]">Add a phrase</label><div className="mt-2 flex gap-2"><input id="new-need" value={newNeed} onChange={(event) => setNewNeed(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addNeed(); } }} maxLength={maxNeedLength} placeholder="For example: Please adjust my pillow" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#cddbd3] px-4 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={addNeed} disabled={!newNeed.trim() || draft.length >= 16} className="min-h-12 rounded-xl border border-[#9fceb3] px-4 text-sm font-bold text-[#1f7a57] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Add</button></div></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button><button type="button" onClick={save} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save phrases</button></div></section></div>;
}

function ConversationSetup({ initialSettings, onClose, onChange, onSave }: { initialSettings: ConversationSettings; onClose: () => void; onChange: (settings: ConversationSettings) => void; onSave: (settings: ConversationSettings) => void }) {
  const [draft, setDraft] = useState(initialSettings);
  useEffect(() => { onChange(draft); }, [draft, onChange]);
  const updateDraft = (next: ConversationSettings) => setDraft(next);
  const updateList = (key: "peopleHere" | "topicsToAvoid" | "phrasesToAvoid", text: string) => updateDraft({ ...draft, [key]: text.split(",").map((item) => item.trim()).filter(Boolean) });
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="conversation-setup-title" className="mx-auto my-4 w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:my-8 sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Your context</p><h2 id="conversation-setup-title" className="mt-2 text-2xl font-bold tracking-tight">Conversation setup</h2><p className="mt-2 text-sm leading-relaxed text-[#607a70]">Saved only in this browser. Cadence uses it to keep replies appropriate.</p></div><button type="button" onClick={onClose} aria-label="Close conversation setup" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-[#315a4b]">Setting<select value={draft.mode} onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as ConversationSettings["mode"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value="family">Family</option><option value="friends">Friends</option><option value="care">Care</option><option value="doctor">Doctor</option><option value="work">Work</option></select></label><label className="text-sm font-bold text-[#315a4b]">Energy<select value={draft.energy} onChange={(event) => setDraft((current) => ({ ...current, energy: event.target.value as ConversationSettings["energy"] }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value="low">Low — fewer choices</option><option value="normal">Normal</option><option value="good">Good</option></select></label></div><label className="mt-4 block text-sm font-bold text-[#315a4b]">Who is here?<input value={draft.peopleHere.join(", ")} onChange={(event) => updateList("peopleHere", event.target.value)} maxLength={600} placeholder="Maya, Jon" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Topics to avoid<input value={draft.topicsToAvoid.join(", ")} onChange={(event) => updateList("topicsToAvoid", event.target.value)} maxLength={600} placeholder="prognosis, finances" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Phrases or humor to avoid<input value={draft.phrasesToAvoid.join(", ")} onChange={(event) => updateList("phrasesToAvoid", event.target.value)} maxLength={600} placeholder="no teasing about my voice" className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]" /></label><label className="mt-4 block text-sm font-bold text-[#315a4b]">Scan speed<select value={draft.scanIntervalMs} onChange={(event) => setDraft((current) => ({ ...current, scanIntervalMs: Number(event.target.value) }))} className="mt-2 min-h-12 w-full rounded-xl border border-[#cddbd3] bg-white px-3 text-base outline-none focus:ring-4 focus:ring-[#9fdfbd]"><option value={900}>Fast</option><option value={1200}>Standard</option><option value={1800}>Slow</option></select><span className="mt-1 block text-xs font-normal text-[#607a70]">Bluetooth switches that send Space or Enter work with scanning.</span></label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => onSave(draft)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save setup</button></div></section></div>;
}

function ReplyPreviewDialog({ suggestion, isFavorite, previewEnabled, basedOn, onClose, onChange, onSpeak, onShorten, onMoreLikeMe, onPreviewChange, onReject, onFavorite, onWrongContext }: { suggestion: Suggestion; isFavorite: boolean; previewEnabled: boolean; basedOn: TranscriptTurn | null; onClose: () => void; onChange: (text: string) => void; onSpeak: () => void; onShorten: () => void; onMoreLikeMe: () => void; onPreviewChange: (enabled: boolean) => void; onReject: (reason: "not_me" | "never") => void; onFavorite: () => void; onWrongContext: (id: string) => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="reply-preview-title" className="w-full max-w-xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Review before speaking</p><h2 id="reply-preview-title" className="mt-2 text-2xl font-bold tracking-tight">Make it yours.</h2></div><button type="button" onClick={onClose} aria-label="Close reply preview" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div>{basedOn && <aside className="mt-4 rounded-2xl border border-[#d9e4dd] bg-[#f7fbf8] p-4" aria-label="Reply context"><p className="text-xs font-bold uppercase tracking-wide text-[#527169]">Based on the latest caption</p><p className="mt-1 text-sm font-semibold leading-relaxed text-[#315a4b]"><span className="font-bold">{basedOn.speaker}:</span> {basedOn.text}</p><button type="button" onClick={() => onWrongContext(basedOn.id)} className="mt-3 min-h-10 rounded-xl border border-[#d9aaa0] bg-white px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Wrong context</button></aside>}<textarea value={suggestion.text} onChange={(event) => onChange(event.target.value)} maxLength={600} aria-label="Edit reply before speaking" className="mt-5 min-h-28 w-full rounded-2xl border border-[#bddac9] bg-[#fbfefb] p-4 text-lg font-semibold leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" /><button type="button" onClick={onSpeak} className="mt-4 min-h-14 w-full rounded-2xl bg-[#1f7a57] px-5 text-base font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Speak this</button><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={onShorten} className="min-h-12 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Shorter</button><button type="button" onClick={onMoreLikeMe} className="min-h-12 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">More like me</button><button type="button" onClick={onFavorite} className="min-h-12 rounded-xl border border-[#cddbd3] px-3 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isFavorite ? "Unsave reply" : "Save reply"}</button><button type="button" onClick={() => onReject("not_me")} className="min-h-12 rounded-xl border border-[#e5c5bc] px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Not me</button></div><label className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-[#f1f7f3] px-4 text-sm font-bold text-[#315a4b]"><span>Preview replies before speaking</span><input type="checkbox" checked={previewEnabled} onChange={(event) => onPreviewChange(event.target.checked)} className="h-5 w-5 accent-[#1f7a57]" /></label><button type="button" onClick={() => onReject("never")} className="mt-2 min-h-11 w-full rounded-xl px-3 text-sm font-bold text-[#9a3c1b] hover:bg-[#fff0eb] focus:outline-none focus:ring-4 focus:ring-[#f2c8bd]">Never suggest this again</button></section></div>;
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
