"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES } from "@/lib/discovery";
import { supabase } from "@/lib/supabase";

const PICKABLE = CATEGORIES.filter((c) => c.key !== "recommended");

export default function Create() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", tagline: "", avatar_url: "", art_credit: "", greeting: "", persona: "", scenario: "", tags: "", visibility: "public", gender: "" });
  const [categories, setCategories] = useState<string[]>([]);
  const [aiArt, setAiArt] = useState(false);
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
        <input placeholder="avatar image url (optional)" value={f.avatar_url} onChange={set("avatar_url")} />
        <label className="switch" style={{ marginLeft: 0 }}>
          <input type="checkbox" role="switch" checked={aiArt} onChange={(e) => setAiArt(e.target.checked)} />
          this art is AI-generated
        </label>
        {!aiArt && <input placeholder="artist credit, e.g. @artist (optional)" value={f.art_credit} onChange={set("art_credit")} maxLength={120} />}
        <textarea rows={6} placeholder="persona: who they are, how they talk, what they want" value={f.persona} onChange={set("persona")} required maxLength={8000} />
        <textarea rows={3} placeholder="scenario: where the chat starts (optional)" value={f.scenario} onChange={set("scenario")} />
        <textarea rows={3} placeholder="greeting: their first message" value={f.greeting} onChange={set("greeting")} />
        <input placeholder="extra tags, comma separated" value={f.tags} onChange={set("tags")} />
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
