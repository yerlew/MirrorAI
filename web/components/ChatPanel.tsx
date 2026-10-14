"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CHATS_CHANGED } from "@/components/ChatList";
import { BotInfo } from "@/components/BotInfo";
import { MemoryPanel } from "@/components/MemoryPanel";
import { PersonaPicker } from "@/components/PersonaPicker";
import { RichText } from "@/components/RichText";
import { sendMessage } from "@/lib/chat";
import { type Character, type Message, profileName, supabase } from "@/lib/supabase";
import { download, exportChat } from "@/lib/transfer";

const REPORT_REASONS = [
  ["mislabeled_nsfw", "adult content not marked 18+"],
  ["minor_sexualized", "sexualizes a minor"],
  ["illegal", "illegal content"],
  ["harassment", "harassment or targets a real person"],
  ["spam", "spam"],
  ["other", "something else"],
] as const;

/** a chat with one bot. full page at /c/[id], or `pane` for the side panel next to the browse grid */
export function ChatPanel({ id, pane, onClose }: { id: string; pane?: boolean; onClose?: () => void }) {
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
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCharacter(null);
    setChatId(null);
    setMessages([]);
    setPersonaId(null);
    setError("");
    setMemoryOpen(false);
    setReporting(false);
    (async () => {
      const { data: c } = await supabase.from("character_cards").select("*").eq("id", id).maybeSingle<Character>();
      setCharacter(c);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setLoggedIn(true);
      const { data: me } = await supabase.from("profiles").select("display_name, handle").eq("id", auth.user.id).single();
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

  async function reload(id: string) {
    const { data: rows } = await supabase.from("messages").select("id, role, content").eq("chat_id", id).order("id");
    setMessages((rows as Message[]) ?? []);
  }

  async function deleteFrom(m: Message) {
    if (busy || typeof m.id !== "number" || !chatId) return;
    if (!confirm("delete this message and everything after it?")) return;
    const { error } = await supabase.rpc("delete_messages_from", { p_message_id: m.id });
    if (error) return setError(error.message);
    setMessages((ms) => ms.filter((x) => typeof x.id !== "number" || x.id < (m.id as number)));
    if (m.role === "user") setDraft(m.content); // so a deleted message can be rewritten
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
    let newChatId = chatId;
    for await (const ev of sendMessage(character.id, chatId, content, personaId)) {
      if (ev.type === "chat") newChatId = ev.chat_id;
      if (ev.type === "chat" && ev.chat_id !== chatId) {
        setChatId(ev.chat_id);
        const { data } = personaId ? await supabase.from("personas").select("name").eq("id", personaId).single() : { data: null };
        setChattingAs(data?.name ?? profileLabel);
      }
      if (ev.type === "delta") setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: x.content + ev.text } : x)));
      if (ev.type === "error") setError(ev.message);
    }
    setMessages((m) => m.filter((x) => !(x.id === "pending" && !x.content)).map((x) => (x.id === "pending" ? { ...x, id: `a${Date.now()}` } : x)));
    if (newChatId) await reload(newChatId); // swap the temporary ids for real ones so messages can be deleted
    setBusy(false);
    window.dispatchEvent(new Event(CHATS_CHANGED));
  }

  if (!character) return <div className={`chat${pane ? " in-pane" : ""}`}><p className="muted" style={{ padding: 16 }}>loading…</p></div>;
  const starting = !chatId && messages.length === 0;

  const chat = (
    <div className={`chat${pane ? " in-pane" : ""}`}>
      {pane && (
        <div className="pane-head">
          <span className="mini-avatar">{character.avatar_url && !character.nsfw_cover ? <img src={character.avatar_url} alt="" /> : character.name[0]}</span>
          <strong>{character.name}</strong>
          <Link href={`/c/${character.id}`} className="icon-btn" title="open full chat" aria-label="open full chat">⤢</Link>
          <button type="button" className="icon-btn" title="close" aria-label="close" onClick={onClose}>✕</button>
        </div>
      )}
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
        <BotInfo c={character} />
        {starting && loggedIn && (
          <PersonaPicker characterId={character.id} characterName={character.name} profileLabel={profileLabel} value={personaId} onChange={setPersonaId} />
        )}
        {starting && !loggedIn && (
          <p className="muted" style={{ textAlign: "center" }}><Link href="/login" style={{ color: "var(--accent)" }}>log in</Link> to chat</p>
        )}
        {character.greeting && <div className="msg assistant"><div className="bubble assistant"><RichText text={character.greeting} /></div></div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className={`bubble ${m.role}`}>{m.content ? <RichText text={m.content} user={m.role === "user"} /> : "…"}</div>
            {typeof m.id === "number" && !busy && (
              <button type="button" className="icon-btn msg-delete" title="delete this and everything after" aria-label="delete this and everything after" onClick={() => deleteFrom(m)}>🗑</button>
            )}
          </div>
        ))}
        {error && <p className="error">{error}</p>}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={2} value={draft} placeholder={`message ${character.name}`} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button disabled={busy || !draft.trim()}>send</button>
      </form>
    </div>
  );
  if (pane) return chat;
  return (
    <div className="chat-page">
      {chat}
      <aside className="bot-side"><BotInfo c={character} side /></aside>
    </div>
  );
}
