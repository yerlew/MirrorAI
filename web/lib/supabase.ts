import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// the vercel supabase integration also sets the newer "publishable" key name; either works
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export const supabase = createClient(SUPABASE_URL || "http://localhost:54321", ANON_KEY || "anon");

/** a row of the character_cards view: what anyone may see about a bot. creator fields are null for anonymous bots. */
export type Character = {
  id: string;
  creator_id: string | null;
  creator_name: string | null;
  creator_username: string | null;
  creator_handle: string | null; // username#tag, e.g. Yerlew#0
  name: string;
  tagline: string | null;
  avatar_url: string | null;
  greeting: string;
  persona: string;
  scenario: string;
  tags: string[];
  visibility: "public" | "unlisted" | "private";
  chat_count: number;
  gender: "male" | "female" | "nonbinary" | null;
  categories: string[];
  ai_art: boolean;
  art_credit: string | null;
  nsfw: boolean;
  nsfw_cover: boolean;
  minor: boolean; // character is under 18: always non-nsfw, can't be changed
  background: string;
  traits: string[];
  quirks: Quirk[];
  warmup: Warmup;
  canon_source: string; // e.g. "Jujutsu Kaisen", or the celebrity's name. empty = original character
  canon: number; // 0 loose / AU … 100 strict canon. not used for real people
  canon_context: string; // which part of the source canon comes from, e.g. season / episode
  real_person: boolean;
  anonymous: boolean;
};

// public identity: shown on comments and on the bots you post
export type Profile = {
  id: string;
  username: string | null;
  tag: string; // permanent number tag, handed out in signup order: 0..9, 00..99, 000..
  handle: string | null; // username#tag, unique
  display_name: string | null;
  avatar_url: string | null;
  bio: string;
  content_filter: ContentFilter;
  adult_confirmed_at: string | null;
};

/** what shows up while browsing: non-nsfw only, everything, or nsfw only */
export type Frequency = "always" | "often" | "sometimes" | "rarely";
export type Quirk = { text: string; frequency: Frequency };
/** how fast a bot warms up to the person chatting. slow is the default: hundreds of messages, not 20 */
export type Warmup = "never" | "slow" | "normal";

export type ContentFilter = "sfw" | "any" | "nsfw";
export const CONTENT_FILTERS: { key: ContentFilter; label: string }[] = [
  { key: "sfw", label: "Non-NSFW" },
  { key: "any", label: "Any" },
  { key: "nsfw", label: "NSFW" },
];

// works on any postgrest select over character_cards
export function applyContentFilter<Q extends { eq(column: string, value: boolean): Q }>(query: Q, filter: ContentFilter): Q {
  if (filter === "sfw") return query.eq("nsfw", false);
  if (filter === "nsfw") return query.eq("nsfw", true);
  return query;
}

/** 18+ covers get blurred unless you're browsing with nsfw allowed */
export function blurCover(c: Character, filter: ContentFilter) {
  return c.nsfw_cover && filter === "sfw";
}


export type CreatorProfile = {
  id: string;
  username: string | null;
  handle: string | null; // username#tag, unique
  display_name: string | null;
  avatar_url: string | null;
  bio: string;
  follower_count: number;
  bot_count: number;
  total_chats: number;
};

// private, only ever readable by their owner
export type Persona = { id: string; user_id: string; name: string; backstory: string; avatar_url: string | null };

export function profileName(p?: { display_name: string | null; handle: string | null } | null) {
  return p?.display_name || p?.handle || "";
}

export function creatorName(c: Character) {
  return c.anonymous ? "anonymous" : profileName({ display_name: c.creator_name, handle: c.creator_handle });
}

export type Message = { id: number | string; role: "user" | "assistant"; content: string };

/** the signed-in user's profile, or null when logged out */
export async function myProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle<Profile>();
  return data;
}

export function compact(n: number) {
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

/** link to someone's public page by their username#tag */
export const handleHref = (handle: string) => `/u/${encodeURIComponent(handle)}`;

/** usernames can be anything except # and control characters, 1-32 long */
export function usernameProblem(name: string) {
  const n = name.trim();
  if (!n) return "pick a username";
  if (n.length > 32) return "username: 32 characters max";
  if (/[#\p{Cc}]/u.test(n)) return "username can't contain #";
  return "";
}
