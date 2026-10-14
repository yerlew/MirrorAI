"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTENT_FILTERS, type ContentFilter, type Persona, type Profile, supabase } from "@/lib/supabase";

export type AccountSection = "user" | "profiles" | "settings";

/** user = your public profile, profiles = your private personas, settings = filter + account */
export function Account({ section }: { section: AccountSection }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editing, setEditing] = useState<Partial<Persona> | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      if (!data.user) return;
      const [{ data: p }, { data: ps }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", data.user.id).single<Profile>(),
        supabase.from("personas").select("*").order("created_at"),
      ]);
      setProfile(p);
      setPersonas((ps as Persona[]) ?? []);
    })();
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError("");
    const { error } = await supabase.from("profiles")
      .update({ display_name: profile.display_name, username: profile.username?.toLowerCase() || null, bio: profile.bio })
      .eq("id", profile.id);
    if (error) setError(error.message.includes("username") ? "username: 3-24 chars, a-z 0-9 _ only, and not taken" : error.message);
    else setSaved("saved");
  }

  async function setFilter(f: ContentFilter) {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ content_filter: f }).eq("id", profile.id);
    if (error) return setError(error.message);
    setProfile({ ...profile, content_filter: f });
  }

  async function savePersona(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !userId) return;
    setError("");
    const row = { name: editing.name ?? "", backstory: editing.backstory ?? "", user_id: userId };
    const { data, error } = editing.id
      ? await supabase.from("personas").update(row).eq("id", editing.id).select().single<Persona>()
      : await supabase.from("personas").insert(row).select().single<Persona>();
    if (error) return setError(error.message);
    setPersonas((ps) => (editing.id ? ps.map((p) => (p.id === data.id ? data : p)) : [...ps, data]));
    setEditing(null);
  }

  async function deletePersona(id: string) {
    if (!confirm("delete this persona? chats that used it keep their history.")) return;
    await supabase.from("personas").delete().eq("id", id);
    setPersonas((ps) => ps.filter((p) => p.id !== id));
    setEditing(null);
  }

  if (userId === undefined) return <main className="muted">loading…</main>;
  if (userId === null) return <main><p>you're not logged in. <Link href="/login" style={{ color: "var(--accent)" }}>log in or sign up</Link></p></main>;

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      {profile && section === "user" && (
        <form className="panel" onSubmit={saveProfile}>
          <h2>Profile</h2>
          <p className="muted" style={{ margin: 0 }}>Public. This is the name on your comments and the bots you post.</p>
          <label className="field">display name
            <input value={profile.display_name ?? ""} onChange={(e) => { setProfile({ ...profile, display_name: e.target.value }); setSaved(""); }} maxLength={40} />
          </label>
          <label className="field">username
            <input value={profile.username ?? ""} placeholder="pick one" onChange={(e) => { setProfile({ ...profile, username: e.target.value }); setSaved(""); }} maxLength={24} />
          </label>
          <label className="field">bio
            <textarea rows={3} value={profile.bio ?? ""} maxLength={500} placeholder="shows on your public creator page" onChange={(e) => { setProfile({ ...profile, bio: e.target.value }); setSaved(""); }} />
          </label>
          <div className="row">
            <button>save</button>
            <span className="muted">{saved}</span>
            {profile.username && <Link href={`/u/${profile.username}`} className="muted" style={{ color: "var(--accent)" }}>view public page</Link>}
          </div>
        </form>
      )}

      {profile && section === "settings" && (
        <section className="panel">
          <h2>Settings</h2>
          <div className="row">
            <span>NSFW filter</span>
            <div className="segmented" role="group" aria-label="NSFW filter">
              {CONTENT_FILTERS.map((f) => (
                <button key={f.key} type="button" aria-pressed={profile.content_filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
              ))}
            </div>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {profile.content_filter === "sfw" && "Non-NSFW: 18+ bots are hidden and 18+ covers are blurred."}
            {profile.content_filter === "any" && "Any: everything shows, unfiltered."}
            {profile.content_filter === "nsfw" && "NSFW: only 18+ bots show."}
            {" "}This is your default; you can switch it for a single search on Discover.
          </p>
          <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <span>Account</span>
            <button type="button" className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => supabase.auth.signOut().then(() => (location.href = "/"))}>log out</button>
          </div>
        </section>
      )}

      {section === "profiles" && <section className="panel">
        <div className="row">
          <h2>Personas</h2>
          <button type="button" style={{ marginLeft: "auto" }} onClick={() => setEditing({ name: "", backstory: "" })}>+ new persona</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Private, only you can see these. Pick one when you start a chat so the bot knows who you are. You can add extra backstory for one specific bot from that bot's chat.
        </p>
        {personas.length === 0 && !editing && <p className="muted">no personas yet. without one, bots just know your display name.</p>}
        <div className="persona-list">
          {personas.map((p) => (
            <button key={p.id} type="button" className="persona" onClick={() => setEditing(p)}>
              <strong>{p.name}</strong>
              <span className="backstory">{p.backstory || "no backstory"}</span>
            </button>
          ))}
        </div>
        {editing && (
          <form className="stack" onSubmit={savePersona} style={{ maxWidth: "none" }}>
            <h3>{editing.id ? "edit persona" : "new persona"}</h3>
            <input placeholder="name the bot will call you" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required maxLength={60} />
            <textarea rows={6} placeholder="backstory: who you are, looks, history, anything the bot should know" value={editing.backstory ?? ""} onChange={(e) => setEditing({ ...editing, backstory: e.target.value })} maxLength={4000} />
            <div className="row">
              <button>save</button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>cancel</button>
              {editing.id && <button type="button" className="btn-ghost" style={{ marginLeft: "auto", color: "var(--danger)" }} onClick={() => deletePersona(editing.id!)}>delete</button>}
            </div>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </section>}
      {section !== "profiles" && error && <p className="error">{error}</p>}
    </main>
  );
}
