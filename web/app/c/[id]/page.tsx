"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CHATS_CHANGED } from "@/components/ChatList";
import { MemoryPanel } from "@/components/MemoryPanel";
import { PersonaPicker } from "@/components/PersonaPicker";
import { sendMessage } from "@/lib/chat";
import { type Character, confirmAdult, creatorName, type Message, myProfile, profileName, supabase } from "@/lib/supabase";
import { download, exportChat } from "@/lib/transfer";

const REPORT_REASONS = [
  ["mislabeled_nsfw", "adult content not marked 18+"],
  ["minor_sexualized", "sexualizes a minor"],
  ["illegal", "illegal content"],
  ["harassment", "harassment or targets a real person"],
  ["spam", "spam"],
  ["other", "something else"],
] as const;

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const [character, setCharacter] = useState<Character | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profileLabel, setProfileLabel] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [chattingAs, setChattingAs] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adult, setAdult] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("character_cards").select("*").eq("id", id).maybeSingle<Character>();
      setCharacter(c);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setLoggedIn(true);
      const { data: me } = await supabase.from("profiles").select("display_name, username, adult_confirmed_at").eq("id", auth.user.id).single();
      setProfileLabel(profileName(me));
      setAdult(!!me?.adult_confirmed_at);
      // resume the most recent chat with this character, if any
      const { data: chat } = await supabase.from("chats").select("id, persona:personas(name)").eq("character_id", id)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle<{ id: string; persona: { name: string } | null }>();
      if (chat) {
        setChatId(chat.id);
        setChattingAs(chat.persona?.name ?? profileName(me));
        const { data: rows } = await supabase.from("messages").select("id, role, content").eq("chat_id", chat.id).order("id");
        setMessages((rows as Message[]) ?? []);
      }
    })();
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function exportThis() {
    if (!character) return;
    let memory = "", pinned = "", covers = 0;
    if (chatId) {
      const { data } = await supabase.from("chats").select("memory, pinned, memory_through").eq("id", chatId).single();
      memory = data?.memory ?? "";
      pinned = data?.pinned ?? "";
      covers = messages.filter((m) => typeof m.id === "number" && m.id <= (data?.memory_through ?? 0)).length;
    }
    download(`${character.name.replace(/[^\w-]+/g, "_")}.mirrorai.json`, exportChat(character, messages, memory, pinned, covers));
  }

  async function report(reason: string) {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user || !character) return;
    await supabase.from("reports").insert({ reporter_id: auth.user.id, character_id: character.id, reason });
    setReporting(false);
    alert("thanks, we got the report.");
  }

  function restart() {
    if (!confirm("start over? this chat's history stays saved, but the bot starts fresh and you can pick a persona again.")) return;
    setChatId(null);
    setMessages([]);
    setError("");
  }

  async function send() {
    const content = draft.trim();
    if (!content || busy || !character) return;
    setDraft("");
    setBusy(true);
    setError("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content }, { id: "pending", role: "assistant", content: "" }]);
    for await (const ev of sendMessage(character.id, chatId, content, personaId)) {
      if (ev.type === "chat" && ev.chat_id !== chatId) {
        setChatId(ev.chat_id);
        const { data } = personaId ? await supabase.from("personas").select("name").eq("id", personaId).single() : { data: null };
        setChattingAs(data?.name ?? profileLabel);
      }
      if (ev.type === "delta") setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: x.content + ev.text } : x)));
      if (ev.type === "error") setError(ev.message);
    }
    setMessages((m) => m.filter((x) => !(x.id === "pending" && !x.content)).map((x) => (x.id === "pending" ? { ...x, id: `a${Date.now()}` } : x)));
    setBusy(false);
    window.dispatchEvent(new Event(CHATS_CHANGED));
  }

  if (!character) return <main className="muted">loading…</main>;
  if (character.nsfw && !adult) {
    return (
      <main style={{ maxWidth: 520 }}>
        <div className="panel">
          <h2>{character.name} is marked 18+</h2>
          <p className="muted" style={{ margin: 0 }}>Confirm you're an adult to open this bot.</p>
          <div className="row"><button onClick={async () => setAdult(await confirmAdult(await myProfile()))}>I'm 18 or older</button></div>
        </div>
      </main>
    );
  }
  const starting = !chatId && messages.length === 0;

  return (
    <div className="chat">
      <div className="chat-top">
        {chatId ? <span>chatting as <strong style={{ color: "var(--text)" }}>{chattingAs || "you"}</strong></span> : <span />}
        <div className="row" style={{ marginLeft: "auto" }}>
          {chatId && <button className="btn-ghost" onClick={() => setMemoryOpen((v) => !v)}>memory</button>}
          <button className="btn-ghost" onClick={exportThis}>export</button>
          {chatId && <button className="btn-ghost" onClick={restart} disabled={busy}>restart</button>}
          {loggedIn && <button className="btn-ghost" onClick={() => setReporting((v) => !v)}>report</button>}
        </div>
      </div>
      {memoryOpen && chatId && <MemoryPanel chatId={chatId} onClose={() => setMemoryOpen(false)} />}
      {reporting && (
        <div className="panel" style={{ margin: "8px 16px" }}>
          <h3>Report {character.name}</h3>
          <div className="row">{REPORT_REASONS.map(([k, label]) => <button key={k} className="btn-ghost" onClick={() => report(k)}>{label}</button>)}</div>
        </div>
      )}
      <div className="log" ref={logRef}>
        <div className="muted" style={{ textAlign: "center" }}>
          <strong style={{ color: "var(--text)" }}>{character.name}</strong>
          <br />
          {character.tagline}
          <br />
          by {character.creator_username ? <Link href={`/u/${character.creator_username}`} style={{ color: "var(--accent)" }}>{creatorName(character)}</Link> : creatorName(character)}
        </div>
        {starting && loggedIn && (
          <PersonaPicker characterId={character.id} characterName={character.name} profileLabel={profileLabel} value={personaId} onChange={setPersonaId} />
        )}
        {starting && !loggedIn && (
          <p className="muted" style={{ textAlign: "center" }}><Link href="/login" style={{ color: "var(--accent)" }}>log in</Link> to chat</p>
        )}
        {character.greeting && <div className="bubble">{character.greeting}</div>}
        {messages.map((m) => <div key={m.id} className={`bubble ${m.role}`}>{m.content || "…"}</div>)}
        {error && <p className="error">{error}</p>}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={2} value={draft} placeholder={`message ${character.name}`} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button disabled={busy || !draft.trim()}>send</button>
      </form>
    </div>
  );
}
