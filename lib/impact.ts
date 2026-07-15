/** Assumed AAC typing baseline for the Cadence impact estimate. */
export const AAC_TYPING_WORDS_PER_MINUTE = 15;

/** Assumed duration of one intentional speech-selection tap. */
export const SPEAK_SELECTION_SECONDS = 1;

export type ReplyImpact = {
  tapsUsed: number;
  typedKeystrokes: number;
  typingSeconds: number;
  secondsSaved: number;
  speedup: number;
  keystrokeSavingsPercent: number;
};

export function calculateReplyImpact(text: string): ReplyImpact {
  const message = text.trim();
  const wordCount = message ? message.split(/\s+/).length : 0;
  const typedKeystrokes = message.length;
  const tapsUsed = 1;
  const typingSeconds = (wordCount / AAC_TYPING_WORDS_PER_MINUTE) * 60;
  const secondsSaved = Math.max(typingSeconds - SPEAK_SELECTION_SECONDS, 0);
  const speedup = typingSeconds > 0 ? typingSeconds / SPEAK_SELECTION_SECONDS : 0;
  const keystrokeSavingsPercent = typedKeystrokes > 0 ? ((typedKeystrokes - tapsUsed) / typedKeystrokes) * 100 : 0;
  return { tapsUsed, typedKeystrokes, typingSeconds, secondsSaved, speedup, keystrokeSavingsPercent };
}

export function calculateSessionImpact(texts: string[]) {
  const impacts = texts.map(calculateReplyImpact);
  const totals = impacts.reduce((summary, impact) => ({
    tapsUsed: summary.tapsUsed + impact.tapsUsed,
    typedKeystrokes: summary.typedKeystrokes + impact.typedKeystrokes,
    secondsSaved: summary.secondsSaved + impact.secondsSaved,
    typingSeconds: summary.typingSeconds + impact.typingSeconds,
  }), { tapsUsed: 0, typedKeystrokes: 0, secondsSaved: 0, typingSeconds: 0 });
  return {
    ...totals,
    speedup: totals.typingSeconds > 0 ? totals.typingSeconds / Math.max(totals.tapsUsed * SPEAK_SELECTION_SECONDS, 1) : 0,
    keystrokeSavingsPercent: totals.typedKeystrokes > 0 ? ((totals.typedKeystrokes - totals.tapsUsed) / totals.typedKeystrokes) * 100 : 0,
  };
}
