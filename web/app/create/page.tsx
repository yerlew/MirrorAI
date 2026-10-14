"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Create() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", tagline: "", avatar_url: "", greeting: "", persona: "", scenario: "", tags: "", visibility: "public" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("log in first"); setBusy(false); return; }
    const { data, error } = await supabase.from("characters").insert({
      ...f,
      avatar_url: f.avatar_url || null,
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
        <input placeholder="avatar image url (optional)" value={f.avatar_url} onChange={set("avatar_url")} />
        <textarea rows={6} placeholder="persona: who they are, how they talk, what they want" value={f.persona} onChange={set("persona")} required maxLength={8000} />
        <textarea rows={3} placeholder="scenario: where the chat starts (optional)" value={f.scenario} onChange={set("scenario")} />
        <textarea rows={3} placeholder="greeting: their first message" value={f.greeting} onChange={set("greeting")} />
        <input placeholder="tags, comma separated" value={f.tags} onChange={set("tags")} />
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
