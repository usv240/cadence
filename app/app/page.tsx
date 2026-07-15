"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribe, type BrowserTranscriber, type LiveTranscriptionStatus } from "@/lib/browser-transcribe";
import { candidatesToSuggestions, conversationService } from "@/lib/conversation-service";
import { neutralStyleCard } from "@/lib/style-card";
import { AAC_TYPING_WORDS_PER_MINUTE, calculateReplyImpact, calculateSessionImpact } from "@/lib/impact";
import { emptyPersonalProfile, type PersonalProfile } from "@/lib/profile";
import type { Candidate, SpokenItem, Suggestion, Tone, TranscriptInput, TranscriptTurn } from "@/lib/conversation";

const initialTranscript: TranscriptTurn[] = [
  { id: "1", speaker: "Maya", text: "This pasta is officially going into the regular rotation.", time: "7:42 PM", color: "orange" },
  { id: "2", speaker: "Jon", text: "Agreed. And we should absolutely do something outside next weekend.", time: "7:42 PM", color: "blue" },
  { id: "3", speaker: "Lena", text: "A picnic? Or is that too ambitious for all of us?", time: "7:43 PM", color: "pink" },
];

const initialTranscriptInput = initialTranscript.map(({ speaker, text }) => ({ speaker, text }));
const tones: Tone[] = ["warm", "firm", "funny"];
const quickReplies = ["mm-hm", "right", "haha", "no way"];
const intents = ["Yes", "No", "one sec", "heart"];
/** Time each target remains highlighted in single-switch scanning mode. */
const SCAN_INTERVAL_MS = 1200;
const floorHoldingPhrases = ["Give me a second, I'd like to respond.", "One moment — I want to add something.", "Hold on a moment, I have a thought."];

export default function Home() {
  const [baseSuggestions, setBaseSuggestions] = useState<Suggestion[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tone, setTone] = useState<Tone>("warm");
  const [transcript, setTranscript] = useState(initialTranscript);
  const [spoken, setSpoken] = useState<SpokenItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [isExpanding, setIsExpanding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [predictionStatus, setPredictionStatus] = useState<"ready" | "preparing">("preparing");
  const [error, setError] = useState("");
  const [listenStatus, setListenStatus] = useState<LiveTranscriptionStatus>("off");
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showQuickControls, setShowQuickControls] = useState(false);
  const [showSpoken, setShowSpoken] = useState(false);
  const [isScanningMode, setIsScanningMode] = useState(false);
  const [scanIndex, setScanIndex] = useState(0);
  const [styleCard, setStyleCard] = useState(neutralStyleCard);
  const [profile, setProfile] = useState<PersonalProfile>(emptyPersonalProfile);
  const [hasLearnedStyle, setHasLearnedStyle] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const liveTranscriber = useRef<BrowserTranscriber | null>(null);
  const prefetchTimer = useRef<number | null>(null);
  const inFlightRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const lastTranscriptText = useRef(initialTranscript.at(-1)?.text);
  const styleCardRef = useRef(neutralStyleCard);
  const profileRef = useRef<PersonalProfile>(emptyPersonalProfile);
  const floorPhraseIndex = useRef(0);

  const applyPredictions = useCallback(async (sourceTranscript: TranscriptInput[], signal: AbortSignal | undefined, version: number) => {
    setIsRefreshing(true);
    setError("");
    try {
      const { candidates } = await conversationService.predict({ transcript: sourceTranscript, styleCard: styleCardRef.current, profile: profileRef.current, n: 4 }, signal);
      if (signal?.aborted || version !== requestVersion.current) return;
      const predictions = candidatesToSuggestions(candidates);
      setBaseSuggestions(predictions);
      setSuggestions(predictions);
      setPredictionStatus("ready");
    } catch (predictionError) {
      if (signal?.aborted || (predictionError instanceof DOMException && predictionError.name === "AbortError")) return;
      if (version === requestVersion.current) setError(predictionError instanceof Error ? predictionError.message : "Unable to load reply suggestions.");
    } finally {
      if (version === requestVersion.current) setIsRefreshing(false);
    }
  }, []);

  const queueSpeculativePrediction = useCallback((sourceTranscript: TranscriptInput[]) => {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    inFlightRequest.current?.abort();
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setPredictionStatus("preparing");
    prefetchTimer.current = window.setTimeout(() => {
      const controller = new AbortController();
      inFlightRequest.current = controller;
      void applyPredictions(sourceTranscript, controller.signal, version).finally(() => {
        if (version === requestVersion.current) inFlightRequest.current = null;
      });
    }, 500);
  }, [applyPredictions]);

  const refreshPredictions = useCallback((sourceTranscript: TranscriptInput[]) => {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    inFlightRequest.current?.abort();
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setPredictionStatus("preparing");
    void applyPredictions(sourceTranscript, undefined, version);
  }, [applyPredictions]);

  const appendPartnerTurn = useCallback((turn: TranscriptTurn) => {
    setTranscript((current) => {
      if (current.at(-1)?.text === turn.text) return current;
      const updated = [...current.slice(-5), turn];
      queueSpeculativePrediction(updated.map(({ speaker, text }) => ({ speaker, text })));
      return updated;
    });
  }, [queueSpeculativePrediction]);

  useEffect(() => {
    const savedStyle = window.localStorage.getItem("cadence.styleCard");
    if (savedStyle) {
      styleCardRef.current = savedStyle;
      setStyleCard(savedStyle);
      setHasLearnedStyle(true);
    }
    const savedProfile = window.localStorage.getItem("cadence.profile");
    if (savedProfile) {
      try { const nextProfile = { ...emptyPersonalProfile, ...JSON.parse(savedProfile) as Partial<PersonalProfile> }; profileRef.current = nextProfile; setProfile(nextProfile); } catch { window.localStorage.removeItem("cadence.profile"); }
    }
    if (!window.localStorage.getItem("cadence.onboardingComplete")) setShowOnboarding(true);
    setStyleReady(true);
  }, []);

  useEffect(() => {
    if (styleReady) refreshPredictions(initialTranscriptInput);
  }, [refreshPredictions, styleReady]);

  useEffect(() => {
    liveTranscriber.current = transcribe(
      (text) => appendPartnerTurn({ id: crypto.randomUUID(), speaker: "Room", text, time: currentTime(), color: "blue" }),
      setListenStatus,
      setError,
    );
    return () => liveTranscriber.current?.stop();
  }, [appendPartnerTurn]);

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

  const transcriptForModel = (): TranscriptInput[] => transcript.map(({ speaker, text }) => ({ speaker, text }));

  const addSpoken = useCallback(async (text: string) => {
    setSpoken((current) => [{ id: crypto.randomUUID(), text, time: "now", impact: calculateReplyImpact(text) }, ...current]);
    try {
      await conversationService.speak(text, tone);
    } catch (speakError) {
      setError(speakError instanceof Error ? speakError.message : "Unable to speak this reply.");
    }
  }, [tone]);

  const holdTheFloor = useCallback(() => {
    const phrase = floorHoldingPhrases[floorPhraseIndex.current % floorHoldingPhrases.length];
    floorPhraseIndex.current += 1;
    void addSpoken(phrase);
  }, [addSpoken]);

  const scanTargets = useMemo(() => [
    ...suggestions.map((suggestion) => ({ id: `suggestion-${suggestion.id}`, label: `${suggestion.label} reply: ${suggestion.text}`, select: () => void addSpoken(suggestion.text) })),
    ...quickReplies.map((reply) => ({ id: `reaction-${reply}`, label: `Quick reaction: ${reply}`, select: () => void addSpoken(reply) })),
    { id: "hold-floor", label: "Hold the floor", select: holdTheFloor },
  ], [addSpoken, holdTheFloor, suggestions]);
  const highlightedTargetId = isScanningMode ? scanTargets[scanIndex]?.id : undefined;

  const selectScannedTarget = useCallback(() => {
    const target = scanTargets[scanIndex];
    if (!target) return;
    target.select();
    setScanIndex(0);
  }, [scanIndex, scanTargets]);

  const toggleScanningMode = () => {
    if (isScanningMode) {
      setIsScanningMode(false);
      return;
    }
    setScanIndex(0);
    setIsScanningMode(true);
  };

  useEffect(() => {
    if (!isScanningMode || !scanTargets.length) return;
    const interval = window.setInterval(() => setScanIndex((current) => (current + 1) % scanTargets.length), SCAN_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isScanningMode, scanTargets.length]);

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
    void addSpoken(message);
  };

  const toggleListening = () => {
    const controller = liveTranscriber.current;
    if (!controller?.supported) {
      setListenStatus("unsupported");
      setError("Live transcription is not supported in this browser. Try Chrome or Edge, or keep using the mock captions.");
      return;
    }
    setError("");
    if (listenStatus === "listening") controller.stop();
    else controller.start();
  };

  const selectTone = async (nextTone: Tone) => {
    setTone(nextTone);
    if (!baseSuggestions.length) return;
    setIsRefreshing(true);
    setError("");
    try {
      const adjusted = await Promise.all(baseSuggestions.map(async (suggestion) => ({ ...suggestion, text: (await conversationService.toneAdjust({ text: suggestion.text, tone: nextTone })).text })));
      setSuggestions(adjusted);
    } catch (toneError) {
      setError(toneError instanceof Error ? toneError.message : "Unable to adjust the tone.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExpand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!keyword.trim()) return;
    setIsExpanding(true);
    setError("");
    try {
      const { variants } = await conversationService.expand({ keyword, transcript: transcriptForModel(), styleCard: styleCardRef.current, profile });
      const expanded = candidatesToSuggestions(variants.map((text): Candidate => ({ text, intent: "other" })));
      setBaseSuggestions(expanded);
      setSuggestions(expanded);
      setKeyword("");
      setPredictionStatus("ready");
    } catch (expandError) {
      setError(expandError instanceof Error ? expandError.message : "Unable to create replies.");
    } finally {
      setIsExpanding(false);
    }
  };

  const sessionImpact = calculateSessionImpact(spoken.map((item) => item.text));

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-3 py-3 pb-24 text-[#122726] sm:px-6 sm:py-6 sm:pb-28 lg:px-10 lg:py-8">
      <a href="#replies" className="skip-link">Skip to reply cards</a>
      {isScanningMode && <p className="sr-only" aria-live="assertive" aria-atomic="true">Scanning {scanTargets[scanIndex]?.label}. Target {scanIndex + 1} of {scanTargets.length}. Press Space or Enter to select.</p>}
      {isScanningMode && <div className="fixed bottom-4 left-4 z-40"><button type="button" onClick={selectScannedTarget} className="min-h-14 rounded-2xl bg-[#f7d341] px-5 text-base font-black text-[#102823] shadow-xl ring-4 ring-[#102823] ring-offset-2 ring-offset-[#f5f7f4] transition hover:bg-[#ffe36b] focus:outline-none focus:ring-4 focus:ring-[#102823]">Select highlighted</button></div>}
      <div className="fixed bottom-3 right-3 z-40"><button type="button" onClick={holdTheFloor} aria-label="Hold the floor and speak a response placeholder" className={`min-h-12 rounded-full bg-[#1f7a57] px-4 text-sm font-bold text-white shadow-xl transition hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] sm:min-h-14 sm:px-5 sm:text-base ${highlightedTargetId === "hold-floor" ? "scale-105 bg-[#f7d341] text-[#102823] ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4]" : ""}`}>Hold the floor</button></div>
      {showOnboarding && <Onboarding onDismiss={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); }} onSetupProfile={() => { window.localStorage.setItem("cadence.onboardingComplete", "1"); setShowOnboarding(false); setShowProfileSetup(true); }} />}
      {showVoiceSetup && <VoiceSetup initialStyleCard={styleCard} hasLearnedStyle={hasLearnedStyle} onClose={() => setShowVoiceSetup(false)} onSave={(nextStyleCard) => { styleCardRef.current = nextStyleCard; window.localStorage.setItem("cadence.styleCard", nextStyleCard); setStyleCard(nextStyleCard); setHasLearnedStyle(true); }} />}
      {showProfileSetup && <ProfileSetup initialProfile={profile} onClose={() => setShowProfileSetup(false)} onSave={(nextProfile) => { profileRef.current = nextProfile; window.localStorage.setItem("cadence.profile", JSON.stringify(nextProfile)); setProfile(nextProfile); setShowProfileSetup(false); refreshPredictions(transcriptForModel()); }} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}

      <div className="mx-auto max-w-[1440px]">
        <header className="relative flex items-center justify-between gap-2 border-b border-[#dbe5de] pb-3 sm:gap-3 sm:pb-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173d3a] text-base font-bold text-white sm:h-11 sm:w-11 sm:rounded-2xl sm:text-lg" aria-hidden="true">C</div><div className="min-w-0"><p className="text-lg font-bold tracking-tight sm:text-xl">Cadence</p><p className="truncate text-xs font-medium text-[#60766e] sm:text-sm">Dinner at Maya&apos;s <span className="mx-1 text-[#a9bbb1]">/</span> Live</p></div></div>
          <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={toggleListening} aria-pressed={listenStatus === "listening"} aria-label={listenStatus === "listening" ? "Turn listening off" : "Turn listening on"} className={`flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-bold transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${listenStatus === "listening" ? "bg-[#1f7a57] text-white" : "bg-[#173d3a] text-white hover:bg-[#28534e]"}`}><span className={`h-2.5 w-2.5 rounded-full ${listenStatus === "listening" ? "animate-pulse bg-[#a6e3c3]" : "bg-[#c6d3cd]"}`} />{listenStatus === "listening" ? "Listening" : listenStatus === "unsupported" ? "Listen unavailable" : "Listen"}</button><div className="relative"><button type="button" onClick={() => setShowMore((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") setShowMore(false); }} aria-expanded={showMore} aria-controls="more-menu" className="min-h-12 rounded-full border border-[#cdd9d2] bg-white px-4 text-sm font-bold text-[#315a4b] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">More</button>{showMore && <div id="more-menu" role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-[#d6e1da] bg-white p-2 shadow-xl"><button type="button" role="menuitem" onClick={() => { setShowVoiceSetup(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Your voice</button><button type="button" role="menuitem" onClick={() => { setShowProfileSetup(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Personal details</button><button type="button" role="menuitem" onClick={() => { toggleScanningMode(); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isScanningMode ? "Turn scanning off" : "Scanning mode"}</button><button type="button" role="menuitem" onClick={() => { setIsDemoPlaying((playing) => !playing); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">{isDemoPlaying ? "Stop demo conversation" : "Play demo conversation"}</button><button type="button" role="menuitem" onClick={() => { setShowAbout(true); setShowMore(false); }} className="min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold text-[#294841] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">About</button></div>}</div></div>
        </header>

        <div className="mt-4 grid gap-5 sm:mt-6 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_310px]">
          <section className="min-w-0" aria-label="Conversation copilot">
            <section className="rounded-2xl border border-[#dce6df] bg-white p-3 sm:rounded-3xl sm:p-5" aria-labelledby="transcript-heading"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">Room transcript</p><h2 id="transcript-heading" className="mt-0.5 text-base font-bold sm:mt-1 sm:text-lg">What&apos;s being said</h2></div><span className="rounded-full bg-[#f1f5f2] px-2.5 py-1 text-[11px] font-bold text-[#54706b] sm:px-3 sm:py-1.5 sm:text-xs">{listenStatus === "listening" ? "Listening" : isDemoPlaying ? "Demo playing" : "Waiting"}</span></div><p className="mt-2 truncate text-sm text-[#4b675e] sm:hidden"><span className="font-bold text-[#294841]">{transcript.at(-1)?.speaker}:</span> {transcript.at(-1)?.text}</p><div className="mt-3 hidden max-h-44 space-y-2 overflow-y-auto pr-1 sm:block" aria-live="polite" aria-relevant="additions">{transcript.map((turn, index) => <TranscriptLine key={turn.id} turn={turn} isLatest={index === transcript.length - 1} />)}<div ref={transcriptEnd} /></div></section>

            <section id="replies" className="mt-4 scroll-mt-4 sm:mt-8" aria-labelledby="replies-heading"><div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3"><div><p className="eyebrow text-[0.65rem] sm:text-[0.72rem]">Your next thought</p><h1 id="replies-heading" className="mt-0.5 text-xl font-bold tracking-tight sm:mt-1 sm:text-3xl">Choose a reply</h1><p className="mt-0.5 text-sm text-[#54706b] sm:mt-1 sm:text-base">Tap a reply to speak it.</p></div><div className="flex items-center gap-1 sm:gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:py-1.5 sm:text-xs ${predictionStatus === "ready" ? "bg-[#e3f4eb] text-[#176746]" : "bg-[#f1f5f2] text-[#54706b]"}`} role="status">{predictionStatus === "ready" ? "Ready" : "Preparing"}</span><button type="button" onClick={() => refreshPredictions(transcriptForModel())} disabled={isRefreshing} className="min-h-10 rounded-xl px-2.5 text-sm font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 sm:min-h-11 sm:px-3">{isRefreshing ? "Refreshing" : "Refresh"}</button></div></div>{isScanningMode && <p className="mt-3 rounded-2xl bg-[#102823] px-4 py-3 text-sm font-bold text-white" role="status">Scanning is on. Press Space or Enter to speak the highlighted choice.</p>}<div className={`mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 xl:grid-cols-4 ${predictionStatus === "ready" ? "motion-safe:animate-[pulse_0.55s_ease-out_1]" : ""}`}>{suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} onSpeak={addSpoken} isScanningHighlighted={highlightedTargetId === `suggestion-${suggestion.id}`} />)}</div>{error && <p className="mt-4 rounded-xl bg-[#fff0eb] px-4 py-3 text-sm font-semibold text-[#9a3c1b]" role="alert">{error}</p>}</section>

            <section className="mt-5 rounded-3xl border border-[#dce6df] bg-white p-4 sm:mt-7 sm:p-5" aria-label="More ways to respond"><button type="button" onClick={() => setShowQuickControls((open) => !open)} aria-expanded={showQuickControls} aria-controls="quick-controls" className="flex min-h-12 w-full items-center justify-between text-left text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] md:hidden"><span>More ways to respond</span><span aria-hidden="true">{showQuickControls ? "−" : "+"}</span></button><div id="quick-controls" className={`${showQuickControls ? "block" : "hidden"} md:block`}><div className="flex flex-col gap-5 pt-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-bold text-[#3e5d53]">Quick reactions</p><div className="mt-3 flex flex-wrap gap-2">{quickReplies.map((reply) => <QuickButton key={reply} text={reply} onClick={addSpoken} isScanningHighlighted={highlightedTargetId === `reaction-${reply}`} />)}{intents.map((intent) => <QuickButton key={intent} text={intent === "heart" ? "♥" : intent} spokenText={intent === "heart" ? "I love you" : intent} onClick={addSpoken} />)}</div></div><fieldset className="shrink-0"><legend className="text-sm font-bold text-[#3e5d53]">Tone</legend><div className="mt-3 flex gap-2">{tones.map((option) => <button key={option} type="button" onClick={() => void selectTone(option)} disabled={isRefreshing} aria-pressed={tone === option} className={`min-h-11 rounded-xl border px-4 text-sm font-bold capitalize transition focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-60 ${tone === option ? "border-[#1f7a57] bg-[#1f7a57] text-white" : "border-[#d5e0d9] bg-white text-[#416158] hover:bg-[#edf5ef]"}`}>{option}</button>)}</div></fieldset></div><div className="mt-5 grid gap-4 border-t border-[#e3ebe6] pt-4 lg:grid-cols-2"><form onSubmit={(event) => void handleExpand(event)}><label htmlFor="keyword" className="text-sm font-bold text-[#3e5d53]">Start with a word or short idea</label><div className="mt-2 flex gap-2"><input id="keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={40} placeholder="For example: picnic" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={isExpanding || !keyword.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">{isExpanding ? "Thinking" : "Make replies"}</button></div></form><form onSubmit={handleCustomSpeak}><label htmlFor="custom-message" className="text-sm font-bold text-[#3e5d53]">Speak your own words</label><div className="mt-2 flex gap-2"><input id="custom-message" value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} maxLength={600} placeholder="Type exactly what you want to say" className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#d5e0d9] bg-white px-4 text-base outline-none placeholder:text-[#80948b] focus:ring-4 focus:ring-[#9fdfbd]" /><button type="submit" disabled={!customMessage.trim()} className="min-h-12 rounded-xl bg-[#1f7a57] px-4 text-sm font-bold text-white hover:bg-[#176746] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] disabled:opacity-50">Speak</button></div></form></div></div>
            </section>
          </section>

          <aside className="rounded-3xl border border-[#dce6df] bg-white p-4 xl:self-start xl:p-5" aria-label="Your spoken log"><div className="flex items-center justify-between"><div><p className="eyebrow">Your voice</p><h2 className="mt-1 text-xl font-bold tracking-tight xl:text-2xl">Spoken</h2></div><button type="button" onClick={() => setShowSpoken((open) => !open)} aria-expanded={showSpoken} aria-controls="spoken-log" className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] xl:hidden">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} {showSpoken ? "−" : "+"}</button><span className="hidden h-10 w-10 place-items-center rounded-full bg-[#edf5ef] text-[#1f7a57] xl:grid" aria-hidden="true">~</span></div><div id="spoken-log" className={`${showSpoken ? "block" : "hidden"} xl:block`}><p className="mt-3 text-xs font-semibold leading-relaxed text-[#5b786a]">{spoken.length} {spoken.length === 1 ? "reply" : "replies"} · ~{sessionImpact.tapsUsed} {sessionImpact.tapsUsed === 1 ? "tap" : "taps"} · ~{(sessionImpact.secondsSaved / 60).toFixed(1)} min saved · ~{sessionImpact.speedup.toFixed(1)}x faster</p><p className="mt-1 text-xs text-[#789087]">Based on {AAC_TYPING_WORDS_PER_MINUTE} words/min typing.</p><div className="mt-5 space-y-3" aria-live="polite">{spoken.length ? spoken.map((item) => <div key={item.id} className="rounded-2xl bg-[#f1f7f3] p-4"><p className="text-base font-semibold leading-relaxed">{item.text}</p><p className="mt-2 text-xs font-bold uppercase tracking-wider text-[#5d8371]">1 tap · ~{Math.round(item.impact.secondsSaved)}s saved</p></div>) : <div className="rounded-2xl border border-dashed border-[#d0ddd5] bg-[#fafcfb] p-5 text-sm leading-relaxed text-[#5c746d]">Your selected replies appear here.</div>}</div></div></aside>
        </div>
      </div>
    </main>
  );
}

function currentTime() { return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()); }

function TranscriptLine({ turn, isLatest }: { turn: TranscriptTurn; isLatest: boolean }) { return <article className={`gap-3 ${isLatest ? "flex" : "hidden sm:flex"}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#edf3ef] text-sm font-bold text-[#416158]">{turn.speaker[0]}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold">{turn.speaker}</p><time className="text-xs font-medium text-[#859992]">{turn.time}</time></div><p className="mt-0.5 text-sm leading-relaxed text-[#4b675e]">{turn.text}</p></div></article>; }

function SuggestionCard({ suggestion, onSpeak, isScanningHighlighted = false }: { suggestion: Suggestion; onSpeak: (text: string) => Promise<void>; isScanningHighlighted?: boolean }) { const styles = { mint: "border-[#b9ddc8] bg-[#eaf8ef]", peach: "border-[#f1cfaa] bg-[#fff3e6]", sky: "border-[#c7dff3] bg-[#edf7ff]", lilac: "border-[#dfcff0] bg-[#f7f0fd]" }; return <button type="button" onClick={() => void onSpeak(suggestion.text)} aria-label={`Speak ${suggestion.label} reply: ${suggestion.text}`} aria-current={isScanningHighlighted || undefined} className={`group min-h-28 rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#2b7a5b] sm:min-h-48 sm:rounded-3xl sm:p-5 ${styles[suggestion.accent]} ${isScanningHighlighted ? "scale-[1.02] bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-[#f5f7f4] shadow-2xl" : ""}`}><span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#49625b] sm:py-1 sm:text-xs">{suggestion.label}</span><p className="mt-2 text-sm font-semibold leading-snug sm:mt-4 sm:text-lg sm:leading-relaxed">{suggestion.text}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#1d654a] sm:mt-4 sm:text-sm" aria-hidden="true">Speak</span></button>; }

function QuickButton({ text, spokenText = text, onClick, isScanningHighlighted = false }: { text: string; spokenText?: string; onClick: (text: string) => Promise<void>; isScanningHighlighted?: boolean }) { return <button type="button" onClick={() => void onClick(spokenText)} aria-label={`Speak ${spokenText}`} aria-current={isScanningHighlighted || undefined} className={`min-h-11 rounded-xl border border-[#d5e0d9] bg-white px-4 text-sm font-bold text-[#416158] transition hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd] ${isScanningHighlighted ? "scale-105 bg-[#f7d341] text-[#102823] ring-4 ring-[#102823] ring-offset-4 ring-offset-white shadow-lg" : ""}`}>{text}</button>; }

function Onboarding({ onDismiss, onSetupProfile }: { onDismiss: () => void; onSetupProfile: () => void }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><p className="eyebrow">Welcome to Cadence</p><h2 id="welcome-title" className="mt-2 text-3xl font-bold tracking-tight">First, make this yours.</h2><p className="mt-3 leading-relaxed text-[#4e6960]">Add the name you use and a few personal details. Cadence uses them only when they help answer the live conversation. You can skip this and add them later from More.</p><ol className="mt-5 space-y-2 text-sm font-semibold leading-relaxed text-[#416158]"><li>1. Add your details</li><li>2. Turn on Listen when you&apos;re ready</li><li>3. Tap a reply to speak</li></ol><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onDismiss} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Skip for now</button><button type="button" autoFocus onClick={onSetupProfile} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Add my details</button></div></section></div>; }

function AboutDialog({ onClose }: { onClose: () => void }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="about-title" className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">About Cadence</p><h2 id="about-title" className="mt-2 text-2xl font-bold tracking-tight">Stay in the conversation.</h2></div><button type="button" onClick={onClose} aria-label="Close about" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><p className="mt-4 leading-relaxed text-[#4e6960]">Cadence listens to complete room turns and prepares replies in your voice, so a thought can be spoken with one tap. Listen uses browser speech recognition when available.</p><button type="button" onClick={onClose} className="mt-6 min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Close</button></section></div>; }

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

function ProfileSetup({ initialProfile, onClose, onSave }: { initialProfile: PersonalProfile; onClose: () => void; onSave: (profile: PersonalProfile) => void }) {
  const [draft, setDraft] = useState(initialProfile);
  const update = (key: keyof PersonalProfile, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-[#102823]/55 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="profile-title" className="mx-auto my-6 w-full max-w-2xl rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Personal details</p><h2 id="profile-title" className="mt-2 text-3xl font-bold tracking-tight">Help Cadence know you.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-[#607a70]">Saved only in this browser. Cadence uses these details only when they help answer what was just said.</p></div><button type="button" onClick={onClose} aria-label="Close personal details" className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-[#315a4b] hover:bg-[#edf5ef] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">×</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-[#315a4b]">Name you use<input value={draft.preferredName} onChange={(event) => update("preferredName", event.target.value)} maxLength={40} autoComplete="given-name" className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="For example: Sam" /></label><label className="text-sm font-bold text-[#315a4b]">Full name<input value={draft.fullName} onChange={(event) => update("fullName", event.target.value)} maxLength={80} autoComplete="name" className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Optional" /></label><label className="text-sm font-bold text-[#315a4b]">Pronouns<input value={draft.pronouns} onChange={(event) => update("pronouns", event.target.value)} maxLength={40} className="mt-2 min-h-12 w-full rounded-xl border border-[#b9d7c6] px-4 text-base font-normal outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Optional" /></label><label className="text-sm font-bold text-[#315a4b] sm:col-span-2">A little about you<textarea value={draft.details} onChange={(event) => update("details", event.target.value)} maxLength={500} className="mt-2 min-h-28 w-full rounded-xl border border-[#b9d7c6] p-4 text-base font-normal leading-relaxed outline-none focus:ring-4 focus:ring-[#9fdfbd]" placeholder="Interests, people you mention often, work, or facts you want replies to draw on when relevant." /></label></div><div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl px-4 font-bold text-[#315a4b] focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Cancel</button><button type="button" onClick={() => onSave(draft)} className="min-h-12 rounded-xl bg-[#1f7a57] px-5 font-bold text-white focus:outline-none focus:ring-4 focus:ring-[#9fdfbd]">Save details</button></div></section></div>;
}
