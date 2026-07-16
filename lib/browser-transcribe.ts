export type LiveTranscriptionStatus = "off" | "listening" | "unsupported";

type SpeechRecognitionAlternative = { transcript: string; confidence?: number };
type SpeechRecognitionResult = { isFinal: boolean; 0: SpeechRecognitionAlternative };
type SpeechRecognitionResultList = { length: number; [index: number]: SpeechRecognitionResult };
type SpeechRecognitionEvent = { resultIndex: number; results: SpeechRecognitionResultList };

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export type BrowserTranscriber = { supported: boolean; start(): void; stop(): void };

export function transcribe(onText: (text: string, confidence?: number) => void, onStatus: (status: LiveTranscriptionStatus) => void, onError: (message: string) => void): BrowserTranscriber {
  if (typeof window === "undefined") return { supported: false, start() {}, stop() {} };
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, start() { onStatus("unsupported"); }, stop() {} };
  const recognition = new Recognition();
  let shouldListen = false;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript.trim();
      if (result.isFinal && text) onText(text, result[0]?.confidence);
    }
  };
  recognition.onerror = (event) => {
    shouldListen = false;
    onStatus("off");
    onError(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone permission was denied. Allow microphone access and try again." : "Live transcription stopped. Please try Listen again.");
  };
  recognition.onend = () => {
    if (shouldListen) recognition.start();
    else onStatus("off");
  };
  return {
    supported: true,
    start() {
      shouldListen = true;
      onStatus("listening");
      recognition.start();
    },
    stop() {
      shouldListen = false;
      recognition.stop();
    },
  };
}
