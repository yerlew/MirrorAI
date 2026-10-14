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
