"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { sendMessage } from "@/lib/chat";
import { type Character, type Message, supabase } from "@/lib/supabase";

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const [character, setCharacter] = useState<Character | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("characters").select("*").eq("id", id).single<Character>();
      setCharacter(c);
      // resume the most recent chat with this character, if any
      const { data: chat } = await supabase.from("chats").select("id").eq("character_id", id)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (chat) {
        setChatId(chat.id);
        const { data: rows } = await supabase.from("messages").select("id, role, content").eq("chat_id", chat.id).order("id");
        setMessages((rows as Message[]) ?? []);
      }
    })();
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const content = draft.trim();
    if (!content || busy || !character) return;
    setDraft("");
    setBusy(true);
    setError("");
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content }, { id: "pending", role: "assistant", content: "" }]);
    for await (const ev of sendMessage(character.id, chatId, content)) {
      if (ev.type === "chat") setChatId(ev.chat_id);
      if (ev.type === "delta") setMessages((m) => m.map((x) => (x.id === "pending" ? { ...x, content: x.content + ev.text } : x)));
      if (ev.type === "error") setError(ev.message);
    }
    setMessages((m) => m.filter((x) => !(x.id === "pending" && !x.content)).map((x) => (x.id === "pending" ? { ...x, id: `a${Date.now()}` } : x)));
    setBusy(false);
  }

  if (!character) return <main className="muted">loading…</main>;

  return (
    <div className="chat">
      <div className="log" ref={logRef}>
        <div className="muted" style={{ textAlign: "center" }}>
          <strong style={{ color: "var(--text)" }}>{character.name}</strong>
          <br />
          {character.tagline}
        </div>
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
