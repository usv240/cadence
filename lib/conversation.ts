export type Tone = "warm" | "firm" | "funny";

export type Intent = "agree" | "ask" | "joke" | "redirect" | "react" | "other";

export type Candidate = {
  text: string;
  intent: Intent;
};

export type TranscriptInput = {
  speaker: string;
  text: string;
};

export type Suggestion = {
  id: string;
  label: string;
  text: string;
  accent: "mint" | "peach" | "sky" | "lilac";
};

export type TranscriptTurn = {
  id: string;
  speaker: string;
  text: string;
  time: string;
  color: "orange" | "blue" | "pink";
  confidence?: number;
  isUncertain?: boolean;
};

export type SpokenItem = {
  id: string;
  text: string;
  time: string;
  impact: import("./impact").ReplyImpact;
};
