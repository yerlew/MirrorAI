// filters for the for-you feed. add a category here and it shows up as a chip on home + in the creator.
export const GENDERS = [
  { key: "all", label: "All" },
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "nonbinary", label: "Non-binary" },
] as const;

export const CATEGORIES = [
  { key: "recommended", label: "Recommended" },
  { key: "anime", label: "Anime" },
  { key: "realism", label: "Realism" },
  { key: "celebrity", label: "Celebrity" },
  { key: "dominant", label: "Dominant" },
  { key: "submissive", label: "Submissive" },
  { key: "oc", label: "OC" },
] as const;

export type Gender = (typeof GENDERS)[number]["key"];
export type Category = (typeof CATEGORIES)[number]["key"];

// default personality traits offered when creating a bot. creators can add their own too.
export const TRAITS = [
  "Brat", "Brat tamer", "Mean", "Kind", "Brute", "Strong", "Smart", "Shy", "Cold", "Flirty", "Tsundere", "Yandere",
  "Sarcastic", "Protective", "Possessive", "Playful", "Dominant", "Submissive", "Arrogant", "Gentle", "Clingy", "Stoic",
  "Chaotic", "Jealous", "Loyal", "Lazy",
];

export const FREQUENCIES = [
  { key: "always", label: "always" },
  { key: "often", label: "often" },
  { key: "sometimes", label: "sometimes" },
  { key: "rarely", label: "rarely" },
] as const;

export const WARMUPS = [
  { key: "slow", label: "slow burn (default): hundreds of messages to warm up" },
  { key: "normal", label: "normal: warms up over a long chat" },
  { key: "never", label: "never: only big story moments change them" },
] as const;
