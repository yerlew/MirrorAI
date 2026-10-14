"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PersonaPicker } from "@/components/PersonaPicker";
import { sendMessage } from "@/lib/chat";
import { type Character, type Message, profileName, supabase } from "@/lib/supabase";

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
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("characters").select("*, creator:profiles(display_name, username)").eq("id", id).single<Character>();
      setCharacter(c);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setLoggedIn(true);
      const { data: me } = await supabase.from("profiles").select("display_name, username").eq("id", auth.user.id).single();
      setProfileLabel(profileName(me));
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
  }

  if (!character) return <main className="muted">loading…</main>;
  const starting = !chatId && messages.length === 0;

  return (
    <div className="chat">
      {chatId && (
        <div className="chat-top">
          <span>chatting as <strong style={{ color: "var(--text)" }}>{chattingAs || "you"}</strong></span>
          <button className="btn-ghost" onClick={restart} disabled={busy}>restart chat</button>
        </div>
      )}
      <div className="log" ref={logRef}>
        <div className="muted" style={{ textAlign: "center" }}>
          <strong style={{ color: "var(--text)" }}>{character.name}</strong>
          <br />
          {character.tagline}
          {character.creator && <><br />by {profileName(character.creator)}</>}
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
