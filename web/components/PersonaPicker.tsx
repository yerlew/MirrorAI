"use client";
import { useEffect, useState } from "react";
import { type Persona, supabase } from "@/lib/supabase";

/** shown only at the start of a chat: pick who you are, optionally add backstory just for this bot */
export function PersonaPicker({ characterId, characterName, profileLabel, value, onChange }: {
  characterId: string;
  characterName: string;
  profileLabel: string;
  value: string | null;
  onChange: (personaId: string | null) => void;
}) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", backstory: "" });
  const [extra, setExtra] = useState("");
  const [extraSaved, setExtraSaved] = useState("");
  const [editingExtra, setEditingExtra] = useState(false);

  useEffect(() => {
    supabase.from("personas").select("*").order("created_at").then(({ data }) => setPersonas((data as Persona[]) ?? []));
  }, []);

  // load this persona's bot-only backstory
  useEffect(() => {
    setExtra("");
    setExtraSaved("");
    setEditingExtra(false);
    if (!value) return;
    supabase.from("persona_overrides").select("extra_backstory").eq("persona_id", value).eq("character_id", characterId).maybeSingle()
      .then(({ data }) => { setExtra(data?.extra_backstory ?? ""); setExtraSaved(data?.extra_backstory ?? ""); });
  }, [value, characterId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data } = await supabase.from("personas").insert({ ...draft, user_id: auth.user.id }).select().single<Persona>();
    if (data) {
      setPersonas((ps) => [...ps, data]);
      onChange(data.id);
      setCreating(false);
      setDraft({ name: "", backstory: "" });
    }
  }

  async function saveExtra() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user || !value) return;
    await supabase.from("persona_overrides").upsert({
      persona_id: value, character_id: characterId, user_id: auth.user.id, extra_backstory: extra, updated_at: new Date().toISOString(),
    });
    setExtraSaved(extra);
    setEditingExtra(false);
  }

  const selected = personas.find((p) => p.id === value);

  return (
    <div className="panel" style={{ margin: "8px 0" }}>
      <h3>Who are you in this chat?</h3>
      <div className="persona-list">
        <button type="button" className="persona" aria-pressed={value === null} onClick={() => onChange(null)}>
          <strong>{profileLabel || "Just me"}</strong>
          <span className="backstory">your profile name, no backstory</span>
        </button>
        {personas.map((p) => (
          <button key={p.id} type="button" className="persona" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
            <strong>{p.name}</strong>
            <span className="backstory">{p.backstory || "no backstory"}</span>
          </button>
        ))}
        <button type="button" className="persona" onClick={() => setCreating(true)} style={{ justifyContent: "center", alignItems: "center", color: "var(--accent)" }}>
          + new persona
        </button>
      </div>

      {creating && (
        <form className="stack" onSubmit={create} style={{ maxWidth: "none" }}>
          <input placeholder="name the bot will call you" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={60} />
          <textarea rows={4} placeholder="backstory (saved to your profile, private)" value={draft.backstory} onChange={(e) => setDraft({ ...draft, backstory: e.target.value })} maxLength={4000} />
          <div className="row">
            <button>save persona</button>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>cancel</button>
          </div>
        </form>
      )}

      {selected && (
        <div className="stack" style={{ maxWidth: "none" }}>
          <div className="row">
            <span className="muted">
              {extraSaved ? `${selected.name} has extra backstory with ${characterName}` : `add backstory ${selected.name} has only with ${characterName}`}
            </span>
            <button type="button" className="btn-ghost" style={{ marginLeft: "auto", padding: "6px 12px" }} onClick={() => setEditingExtra((v) => !v)}>
              {editingExtra ? "close" : "edit"}
            </button>
          </div>
          {editingExtra && (
            <>
              <textarea rows={4} placeholder={`e.g. you and ${characterName} grew up together. this only applies to this bot.`} value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={4000} />
              <div className="row"><button type="button" onClick={saveExtra} disabled={extra === extraSaved}>save for this bot</button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
