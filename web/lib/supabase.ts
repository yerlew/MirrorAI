import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL || "http://localhost:54321", ANON_KEY || "anon");

export type Character = {
  id: string;
  creator_id: string;
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
  creator?: { display_name: string | null; username: string | null } | null;
};

// public identity: shown on comments and on the bots you post
export type Profile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null };

// private, only ever readable by their owner
export type Persona = { id: string; user_id: string; name: string; backstory: string; avatar_url: string | null };

export function profileName(p?: { display_name: string | null; username: string | null } | null) {
  return p?.display_name || (p?.username ? `@${p.username}` : "");
}

export type Message = { id: number | string; role: "user" | "assistant"; content: string };
