"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CATEGORIES, type Category, GENDERS, type Gender } from "@/lib/discovery";
import {
  applyContentFilter, blurCover, type Character, compact, CONTENT_FILTERS, type ContentFilter, creatorName, myProfile,
  supabase,
} from "@/lib/supabase";

const NO_AI_ART_KEY = "mirror.noAiArt";

/** "?bot=<id>" opens that bot in the side pane next to the grid */
function botFromUrl() {
  return typeof window === "undefined" ? null : new URLSearchParams(location.search).get("bot");
}

/** the bot grid used by home and discover. on wide screens a click opens the bot in a side pane; on phones it opens the chat page */
export function Browse({ title, searchFirst }: { title: string; searchFirst?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [q, setQ] = useState("");
  const [gender, setGender] = useState<Gender>("all");
  const [category, setCategory] = useState<Category>("recommended");
  const [noAiArt, setNoAiArt] = useState(false);
  // starts at your profile setting; changing it here only applies to this search
  const [filter, setFilter] = useState<ContentFilter | null>(null); // null until we know

  useEffect(() => {
    setSelected(botFromUrl());
    const onPop = () => setSelected(botFromUrl());
    window.addEventListener("popstate", onPop);
    try { setNoAiArt(localStorage.getItem(NO_AI_ART_KEY) === "1"); } catch {}
    myProfile().then((p) => setFilter(p?.content_filter ?? "sfw"));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string | null, e?: React.MouseEvent) {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || !matchMedia("(min-width: 900px)").matches)) return; // new tab, or phone: normal link
    e?.preventDefault();
    setSelected(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("bot", id);
    else url.searchParams.delete("bot");
    history.pushState(null, "", url);
  }

  function toggleAiArt(on: boolean) {
    setNoAiArt(on);
    try { localStorage.setItem(NO_AI_ART_KEY, on ? "1" : "0"); } catch {}
  }

  useEffect(() => {
    if (filter === null) return;
    // "recommended" is popularity for now; swap in a real ranking later
    let query = supabase.from("character_cards").select("*").eq("visibility", "public").eq("limited", false).order("chat_count", { ascending: false }).limit(60);
    const term = q.trim().replace(/[,()*%\\"]/g, " ").trim();
    if (term) query = query.or(`name.ilike.*${term}*,tagline.ilike.*${term}*,intro.ilike.*${term}*,tags.cs.{"${term.toLowerCase()}"}`);
    if (gender !== "all") query = query.eq("gender", gender);
    if (category !== "recommended") query = query.contains("categories", [category]);
    if (noAiArt) query = query.eq("ai_art", false);
    query = applyContentFilter(query, filter);
    query.then(({ data }) => setChars((data as Character[]) ?? []));
  }, [q, gender, category, noAiArt, filter]);


  return (
    <div className={`browse${selected ? " has-pane" : ""}`}>
      <main>
        <input placeholder="Search characters, tags, anime…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={searchFirst} />

        <div className="feed-head">
          <h1>{q.trim() ? `Results for “${q.trim()}”` : title}</h1>
          <div className="segmented" role="group" aria-label="Gender">
            {GENDERS.map((g) => (
              <button key={g.key} aria-pressed={gender === g.key} onClick={() => setGender(g.key)}>{g.label}</button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Content filter for this search" title="Applies to this search. Set your default in profile.">
            {CONTENT_FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
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
            <Link key={c.id} href={`/c/${c.id}`} className={`card${selected === c.id ? " selected" : ""}`} onClick={(e) => open(c.id, e)}>
              <div className="art">
                {c.name[0]}
                {c.avatar_url && <img src={c.avatar_url} alt="" className={filter && blurCover(c, filter) ? "blur" : undefined} />}
                <span className="count">💬 {compact(c.message_count)}</span>
                {c.art_credit && <span className="credit">art: {c.art_credit}</span>}
              </div>
              <div className="body">
                <span className="name">{c.name}{c.nsfw && <span className="badge">18+</span>}</span>
                {(c.intro || c.tagline) && <span className="tagline">{c.intro || c.tagline}</span>}
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
      {selected && <aside className="pane"><ChatPanel id={selected} pane onClose={() => open(null)} /></aside>}
    </div>
  );
}
