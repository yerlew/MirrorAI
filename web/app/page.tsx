"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORIES, type Category, GENDERS, type Gender } from "@/lib/discovery";
import {
  applyContentFilter, blurCover, type Character, compact, CONTENT_FILTERS, type ContentFilter, confirmAdult, creatorName, myProfile,
  type Profile, supabase,
} from "@/lib/supabase";

const NO_AI_ART_KEY = "mirror.noAiArt";

export default function ForYou() {
  const [chars, setChars] = useState<Character[]>([]);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender>("all");
  const [category, setCategory] = useState<Category>("recommended");
  const [noAiArt, setNoAiArt] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // starts at your profile setting; changing it here only applies to this search
  const [filter, setFilter] = useState<ContentFilter | null>(null); // null until we know

  useEffect(() => {
    try { setNoAiArt(localStorage.getItem(NO_AI_ART_KEY) === "1"); } catch {}
    myProfile().then((p) => { setProfile(p); setFilter(p?.content_filter ?? "sfw"); });
  }, []);

  function toggleAiArt(on: boolean) {
    setNoAiArt(on);
    try { localStorage.setItem(NO_AI_ART_KEY, on ? "1" : "0"); } catch {}
  }

  useEffect(() => {
    if (filter === null) return;
    // "recommended" is popularity for now; swap in a real ranking later
    let query = supabase.from("character_cards").select("*").eq("visibility", "public").order("chat_count", { ascending: false }).limit(60);
    if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
    if (gender !== "all") query = query.eq("gender", gender);
    if (category !== "recommended") query = query.contains("categories", [category]);
    if (noAiArt) query = query.eq("ai_art", false);
    query = applyContentFilter(query, filter);
    query.then(({ data }) => setChars((data as Character[]) ?? []));
  }, [q, gender, category, noAiArt, filter]);

  async function pickFilter(f: ContentFilter) {
    if (f !== "sfw" && !(await confirmAdult(profile))) return;
    if (profile && !profile.adult_confirmed_at) setProfile({ ...profile, adult_confirmed_at: new Date().toISOString() });
    setFilter(f);
  }

  return (
    <main>
      <input placeholder="Search characters" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="feed-head">
        <h1>For you</h1>
        <div className="segmented" role="group" aria-label="Gender">
          {GENDERS.map((g) => (
            <button key={g.key} aria-pressed={gender === g.key} onClick={() => setGender(g.key)}>{g.label}</button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Content filter for this search" title="Applies to this search. Set your default in profile.">
          {CONTENT_FILTERS.map((f) => (
            <button key={f.key} aria-pressed={filter === f.key} onClick={() => pickFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <label className="switch" title="Only show characters with human-made art">
          No AI art
          <input type="checkbox" role="switch" checked={noAiArt} onChange={(e) => toggleAiArt(e.target.checked)} />
        </label>
      </div>

      <div className="chips" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c.key} className="chip" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>
        ))}
      </div>

      <div className="grid">
        {chars.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className="card">
            <div className="art">
              {c.name[0]}
              {c.avatar_url && <img src={c.avatar_url} alt="" className={filter && blurCover(c, filter) ? "blur" : undefined} />}
              <span className="count">💬 {compact(c.chat_count)}</span>
              {c.art_credit && <span className="credit">art: {c.art_credit}</span>}
            </div>
            <div className="body">
              <span className="name">{c.name}{c.nsfw && <span className="badge">18+</span>}</span>
              {c.tagline && <span className="tagline">{c.tagline}</span>}
              <span className="muted">by {creatorName(c)}</span>
              {c.tags.length > 0 && (
                <div className="tags">{c.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>
              )}
            </div>
          </Link>
        ))}
      </div>
      {chars.length === 0 && <p className="muted">nothing here yet. <Link href="/create" style={{ color: "var(--accent)" }}>make the first one</Link>.</p>}
    </main>
  );
}
