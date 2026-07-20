import type { Candidate, Intent, Tone, TranscriptInput, TranscriptTurn } from "./conversation";
import type { PersonalProfile } from "./profile";
import type { ConversationMemory } from "./memory";

const transcriptLines: Omit<TranscriptTurn, "id" | "time">[] = [
  { speaker: "Maya", text: "This pasta is officially going into the regular rotation.", color: "orange" },
  { speaker: "Jon", text: "Agreed. And we should absolutely do something outside next weekend.", color: "blue" },
  { speaker: "Maya", text: "A picnic? Or is that too ambitious for all of us?", color: "orange" },
  { speaker: "Lena", text: "Not if someone else remembers the blanket this time.", color: "pink" },
  { speaker: "Jon", text: "I can be trusted with snacks. The rest is still under review.", color: "blue" },
];

const tonePrefixes: Record<Tone, string[]> = {
  warm: ["Warmly, ", "I like that, ", "That sounds good, ", "I'm on board, "],
  firm: ["Yes. ", "Let's do it. ", "I vote we make that happen. ", "Absolutely. "],
  funny: ["Plot twist: ", "Bold proposal: ", "For legal reasons, ", "My official position: "],
};

export function mockPredict({ transcript, profile, memory, keyword, count = 4 }: { transcript: TranscriptInput[]; profile?: PersonalProfile; memory?: ConversationMemory; keyword?: string; count?: number }): Candidate[] {
  const latest = transcript.at(-1)?.text.trim() || "the conversation";
  const topic = latest.toLowerCase();
  const name = profile?.preferredName.trim() || profile?.fullName.trim().split(/\s+/)[0] || "";
  const candidates = topic.includes("weekend")
    ? [
      { text: "Mine was pretty restful, thanks for asking.", intent: "react" as const },
      { text: "Did you get up to anything fun?", intent: "ask" as const },
      { text: "Mostly I gave my alarm clock the weekend off too.", intent: "joke" as const },
      { text: "It sounds like a good reset either way.", intent: "agree" as const },
    ]
    : topic.includes("how are you") || topic.includes("how're you")
      ? [
        { text: "I'm doing well, thanks for asking.", intent: "react" as const },
        { text: "How are you doing today?", intent: "ask" as const },
        { text: "I am operating on optimism and decent coffee.", intent: "joke" as const },
        { text: "It's good to hear your voice.", intent: "agree" as const },
      ]
      : (topic.includes("what's your name") || topic.includes("what is your name") || topic.includes("what should i call you")) && name
        ? [
          { text: `I'm ${name}. It's nice to meet you.`, intent: "react" as const },
          { text: "What should I call you?", intent: "ask" as const },
          { text: `Just ${name} is perfect. My autograph is terrible anyway.`, intent: "joke" as const },
          { text: "I'm glad we're getting to talk.", intent: "agree" as const },
        ]
        : [
          { text: memory?.topics[0] ? `I was thinking about ${memory.topics[0]} after what you said about ${latest.replace(/[?!.]+$/, "").toLowerCase()}.` : `I was thinking about what you said about ${latest.replace(/[?!.]+$/, "").toLowerCase()}.`, intent: "react" as const },
          { text: "Could you say a little more about that?", intent: "ask" as const },
          { text: "That sounds like the kind of plot twist I can get behind.", intent: "joke" as const },
          { text: "I hear you. Thanks for sharing that.", intent: "agree" as const },
        ];
  if (keyword?.trim()) candidates[0] = { text: `I keep thinking about ${keyword.trim()} in relation to that.`, intent: "react" };
  return candidates.slice(0, count);
}

export function mockExpand({ keyword, transcript }: { keyword: string; transcript: TranscriptInput[]; profile?: PersonalProfile }): string[] {
  const word = keyword.trim() || "that";
  const topic = transcript.at(-1)?.text.replace(/[?!.]+$/, "") || "that";
  return [
    `I keep thinking about ${word} after what you said about ${topic.toLowerCase()}.`,
    `How does ${word} fit with what you just mentioned?`,
    `I am open to ${word}, as long as it still works for this conversation.`,
  ];
}

export function mockInitiate({ transcript, profile, memory, keyword, count = 4 }: { transcript: TranscriptInput[]; profile?: PersonalProfile; memory?: ConversationMemory; keyword?: string; count?: number }): Candidate[] {
  const detail = profile?.details.split(/[.!]/).map((item) => item.trim()).find(Boolean);
  const recentTopic = transcript.at(-1)?.text.replace(/[?!.]+$/, "").trim();
  const steer = keyword?.trim();
  const candidates: Candidate[] = [
    { text: steer ? `I've been thinking about ${steer} lately, and I wanted to share it with you.` : detail ? `I've been thinking about ${detail.toLowerCase()} lately, and I wanted to share it with you.` : memory?.topics[0] ? `I've been thinking about ${memory.topics[0]} lately, and I wanted to share it with you.` : "I've been thinking about something lately, and I wanted to share it with you.", intent: "react" },
    { text: recentTopic ? `How have you been feeling about ${recentTopic.toLowerCase()}?` : "How has your day been going so far?", intent: "ask" },
    { text: "Can I bring up something that's been on my mind?", intent: "redirect" },
    { text: "I just wanted to say I appreciate you and I'm glad we're talking.", intent: "agree" },
  ];
  return candidates.slice(0, count);
}

export function mockToneAdjust(text: string, tone: Tone): string {
  const prefix = tonePrefixes[tone][0];
  return `${prefix}${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function mockTranscribe(previousText?: string): TranscriptTurn {
  const choices = transcriptLines.filter((line) => line.text !== previousText);
  const line = choices[Math.floor(Math.random() * choices.length)];
  return { ...line, id: crypto.randomUUID(), time: new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date()) };
}

export const intents: Intent[] = ["agree", "ask", "joke", "redirect", "react", "other"];
