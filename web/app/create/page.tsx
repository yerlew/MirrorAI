"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES, FREQUENCIES, TRAITS, WARMUPS } from "@/lib/discovery";
import { type Quirk, supabase, type Warmup } from "@/lib/supabase";

const PICKABLE = CATEGORIES.filter((c) => c.key !== "recommended");

export default function Create() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", tagline: "", avatar_url: "", art_credit: "", greeting: "", persona: "", scenario: "", tags: "", visibility: "public", gender: "", background: "" });
  const [categories, setCategories] = useState<string[]>([]);
  const [aiArt, setAiArt] = useState(false);
  const [nsfw, setNsfw] = useState(false);
  const [nsfwCover, setNsfwCover] = useState(false);
  const [minor, setMinor] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [traits, setTraits] = useState<string[]>([]);
  const [customTrait, setCustomTrait] = useState("");
  const [quirks, setQuirks] = useState<Quirk[]>([]);
  const [warmup, setWarmup] = useState<Warmup>("slow");
  const [basedOn, setBasedOn] = useState<"original" | "character" | "real">("original");
  const [canonSource, setCanonSource] = useState("");
  const [canon, setCanon] = useState(70);
  const [canonContext, setCanonContext] = useState("");
  const toggleTrait = (t: string) => setTraits((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : ts.length < 20 ? [...ts, t] : ts));
  function addCustomTrait() {
    const t = customTrait.trim().slice(0, 40);
    if (t && !traits.includes(t)) toggleTrait(t);
    setCustomTrait("");
  }
  const setQuirk = (i: number, q: Partial<Quirk>) => setQuirks((qs) => qs.map((x, j) => (j === i ? { ...x, ...q } : x)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const toggle = (k: string) => setCategories((cs) => (cs.includes(k) ? cs.filter((c) => c !== k) : [...cs, k]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("log in first"); setBusy(false); return; }
    const { data, error } = await supabase.from("characters").insert({
      ...f,
      avatar_url: f.avatar_url || null,
      art_credit: aiArt ? null : f.art_credit || null,
      gender: f.gender || null,
      categories,
      ai_art: aiArt,
      minor,
      nsfw: !minor && basedOn !== "real" && nsfw,
      nsfw_cover: !minor && (nsfw || nsfwCover),
      anonymous,
      traits,
      quirks: quirks.filter((q) => q.text.trim()).map((q) => ({ ...q, text: q.text.trim() })),
      warmup,
      canon_source: basedOn === "original" ? "" : canonSource.trim(),
      canon,
      canon_context: basedOn === "character" ? canonContext.trim() : "",
      real_person: basedOn === "real",
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      creator_id: auth.user.id,
    }).select("id").single();
    setBusy(false);
    if (error) setError(error.message);
    else router.push(`/c/${data.id}`);
  }

  return (
    <main>
      <form className="stack" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>new character</h2>
        <input placeholder="name" value={f.name} onChange={set("name")} required maxLength={60} />
        <input placeholder="tagline, one line" value={f.tagline} onChange={set("tagline")} maxLength={140} />
        <select value={f.gender} onChange={set("gender")}>
          <option value="">gender: unspecified</option>
          <option value="male">male</option>
          <option value="female">female</option>
          <option value="nonbinary">non-binary</option>
        </select>
        <div className="chips" style={{ flexWrap: "wrap", marginBottom: 0 }}>
          {PICKABLE.map((c) => (
            <button type="button" key={c.key} className="chip" aria-pressed={categories.includes(c.key)} onClick={() => toggle(c.key)}>{c.label}</button>
          ))}
        </div>
        <div className="builder">
          <strong>Based on</strong>
          <div className="segmented" role="group" aria-label="Based on" style={{ alignSelf: "flex-start" }}>
            {([["original", "Original (OC)"], ["character", "Existing character"], ["real", "Real person"]] as const).map(([k, label]) => (
              <button type="button" key={k} aria-pressed={basedOn === k} onClick={() => setBasedOn(k)}>{label}</button>
            ))}
          </div>
          {basedOn !== "original" && (
            <>
              <input placeholder={basedOn === "real" ? "who, e.g. their name and what they're known for" : "from what, e.g. Jujutsu Kaisen (anime/manga)"}
                value={canonSource} maxLength={200} onChange={(e) => setCanonSource(e.target.value)} required />
              {basedOn === "character" && (
                <>
                  <label className="canon">
                    <span>non-canon</span>
                    <input type="range" min={0} max={100} step={5} value={canon} onChange={(e) => setCanon(Number(e.target.value))} />
                    <span>canon</span>
                  </label>
                  <span className="muted">
                    {canon >= 70 && "Sticks to canon: personality, voice, relationships and events from the source. Your notes below add to it."}
                    {canon >= 35 && canon < 70 && "Canon-inspired: canon personality and backstory, but the story can go its own way. Your notes win where they differ."}
                    {canon < 35 && "Non-canon / AU: only the name, look and vibe come from the source. Your notes define the rest."}
                  </span>
                  <textarea rows={3} maxLength={2000} value={canonContext} onChange={(e) => setCanonContext(e.target.value)}
                    placeholder="canon context: where to take canon from, e.g. anime only, seasons 1-2, up to ep 41 (Shibuya arc). no manga spoilers past that." />
                  <span className="muted">The bot acts like nothing after this point has happened yet.</span>
                </>
              )}
              {basedOn === "real" && <span className="muted">Uses their public persona. Real-person bots can't be 18+.</span>}
            </>
          )}
        </div>
        <input placeholder="avatar image url (optional)" value={f.avatar_url} onChange={set("avatar_url")} />
        <label className="switch" style={{ marginLeft: 0 }}>
          <input type="checkbox" role="switch" checked={aiArt} onChange={(e) => setAiArt(e.target.checked)} />
          this art is AI-generated
        </label>
        {!aiArt && <input placeholder="artist credit, e.g. @artist (optional)" value={f.art_credit} onChange={set("art_credit")} maxLength={120} />}
        <textarea rows={6} placeholder="personality: who they are, how they talk, what they want" value={f.persona} onChange={set("persona")} required maxLength={8000} />
        <textarea rows={4} placeholder="background: history, family, job, past relationships, anything that shaped them (optional)" value={f.background} onChange={set("background")} maxLength={8000} />

        <div className="builder">
          <strong>Personality traits</strong>
          <span className="muted">The bot re-reads these before every reply, so they don't fade over a long chat.</span>
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 0 }}>
            {[...TRAITS, ...traits.filter((t) => !TRAITS.includes(t))].map((t) => (
              <button type="button" key={t} className="chip" aria-pressed={traits.includes(t)} onClick={() => toggleTrait(t)}>{t}</button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input placeholder="custom trait, e.g. secretly romantic" value={customTrait} maxLength={40} onChange={(e) => setCustomTrait(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTrait(); } }} />
            <button type="button" className="btn-ghost" onClick={addCustomTrait}>add</button>
          </div>
        </div>

        <div className="builder">
          <strong>Quirks & tics</strong>
          <span className="muted">Little habits and how often they show up, e.g. "clicks her tongue when annoyed", "calls you 'idiot' affectionately".</span>
          {quirks.map((q, i) => (
            <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
              <input placeholder="quirk" value={q.text} maxLength={200} onChange={(e) => setQuirk(i, { text: e.target.value })} />
              <select value={q.frequency} style={{ width: 130 }} onChange={(e) => setQuirk(i, { frequency: e.target.value as Quirk["frequency"] })}>
                {FREQUENCIES.map((fr) => <option key={fr.key} value={fr.key}>{fr.label}</option>)}
              </select>
              <button type="button" className="icon-btn" aria-label="remove quirk" onClick={() => setQuirks((qs) => qs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {quirks.length < 20 && (
            <button type="button" className="btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setQuirks((qs) => [...qs, { text: "", frequency: "sometimes" }])}>+ add quirk</button>
          )}
        </div>

        <label className="field">how fast they warm up to the user
          <select value={warmup} onChange={(e) => setWarmup(e.target.value as Warmup)}>
            {WARMUPS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </label>
        <textarea rows={3} placeholder="scenario: where the chat starts (optional)" value={f.scenario} onChange={set("scenario")} />
        <textarea rows={3} placeholder="greeting: their first message" value={f.greeting} onChange={set("greeting")} />
        <input placeholder="extra tags, comma separated" value={f.tags} onChange={set("tags")} />
        <label className="switch" style={{ marginLeft: 0 }}>
          <input type="checkbox" role="switch" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
          this character is under 18 (locks the bot to non-NSFW for good)
        </label>
        {!minor && basedOn !== "real" && (
          <label className="switch" style={{ marginLeft: 0 }}>
            <input type="checkbox" role="switch" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
            this bot is 18+ (hidden from anyone with the NSFW filter on)
          </label>
        )}
        {!minor && !nsfw && (
          <label className="switch" style={{ marginLeft: 0 }}>
            <input type="checkbox" role="switch" checked={nsfwCover} onChange={(e) => setNsfwCover(e.target.checked)} />
            the cover image is 18+ (blurred for anyone with the filter on)
          </label>
        )}
        <label className="switch" style={{ marginLeft: 0 }}>
          <input type="checkbox" role="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          post anonymously (your name and profile won't show on this bot)
        </label>
        <select value={f.visibility} onChange={set("visibility")}>
          <option value="public">public</option>
          <option value="unlisted">unlisted (link only)</option>
          <option value="private">private</option>
        </select>
        <button disabled={busy}>{busy ? "saving…" : "create"}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
