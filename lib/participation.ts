export type ParticipationEvent = {
  kind: "spoken" | "initiated" | "edited" | "rejected" | "rated_like_me" | "rated_not_me";
  at: number;
  responseSeconds?: number;
};

export type ParticipationSummary = {
  replies: number;
  initiated: number;
  edited: number;
  rejected: number;
  averageResponseSeconds: number | null;
  soundsLikeMePercent: number | null;
};

export function summarizeParticipation(events: ParticipationEvent[]): ParticipationSummary {
  const count = (kind: ParticipationEvent["kind"]) => events.filter((event) => event.kind === kind).length;
  const responseTimes = events.flatMap((event) => event.responseSeconds === undefined ? [] : [event.responseSeconds]);
  const ratings = count("rated_like_me") + count("rated_not_me");
  return {
    replies: count("spoken"),
    initiated: count("initiated"),
    edited: count("edited"),
    rejected: count("rejected"),
    averageResponseSeconds: responseTimes.length ? Math.round(responseTimes.reduce((total, seconds) => total + seconds, 0) / responseTimes.length) : null,
    soundsLikeMePercent: ratings ? Math.round((count("rated_like_me") / ratings) * 100) : null,
  };
}
