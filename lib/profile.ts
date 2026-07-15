export type PersonalProfile = {
  preferredName: string;
  fullName: string;
  pronouns: string;
  details: string;
};

export const emptyPersonalProfile: PersonalProfile = {
  preferredName: "",
  fullName: "",
  pronouns: "",
  details: "",
};

export function validatePersonalProfile(profile: unknown): string | null {
  if (profile === undefined) return null;
  if (!profile || typeof profile !== "object") return "profile must be an object.";
  const candidate = profile as Record<string, unknown>;
  const limits: Record<keyof PersonalProfile, number> = { preferredName: 40, fullName: 80, pronouns: 40, details: 500 };
  for (const [key, limit] of Object.entries(limits) as [keyof PersonalProfile, number][]) {
    if (typeof candidate[key] !== "string") return `profile.${key} is required.`;
    if (candidate[key].length > limit) return `profile.${key} must contain ${limit} characters or fewer.`;
  }
  return null;
}
