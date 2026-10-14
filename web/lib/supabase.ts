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
};

export type Message = { id: number | string; role: "user" | "assistant"; content: string };
