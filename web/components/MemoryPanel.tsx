"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** what the bot remembers about this chat. pinned facts are yours; the summary is written by the bot but you can fix it. */
export function MemoryPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [pinned, setPinned] = useState("");
  const [memory, setMemory] = useState("");
  const [saved, setSaved] = useState({ pinned: "", memory: "" });
  const [status, setStatus] = useState("");

  useEffect(() => {
    supabase.from("chats").select("memory, pinned").eq("id", chatId).single().then(({ data }) => {
      if (!data) return;
      setPinned(data.pinned);
      setMemory(data.memory);
      setSaved({ pinned: data.pinned, memory: data.memory });
    });
  }, [chatId]);

  async function save() {
    const { error } = await supabase.from("chats").update({ pinned, memory }).eq("id", chatId);
    if (error) return setStatus(error.message);
    setSaved({ pinned, memory });
    setStatus("saved");
  }

  const dirty = pinned !== saved.pinned || memory !== saved.memory;

  return (
    <div className="panel" style={{ margin: "8px 16px" }}>
      <div className="row">
        <h3>Memory</h3>
        <button type="button" className="btn-ghost" style={{ marginLeft: "auto", padding: "6px 12px" }} onClick={onClose}>close</button>
      </div>
      <label className="field">
        pinned: things the bot must always remember (it never changes these)
        <textarea rows={4} value={pinned} maxLength={4000} placeholder="e.g. my character is left-handed. we got married in chapter 2. never call me sir."
          onChange={(e) => { setPinned(e.target.value); setStatus(""); }} />
      </label>
      <label className="field">
        what the bot remembers from older messages (it writes this as the chat grows; fix anything it got wrong)
        <textarea rows={8} value={memory} placeholder="empty until the chat gets long" onChange={(e) => { setMemory(e.target.value); setStatus(""); }} />
      </label>
      <div className="row">
        <button type="button" onClick={save} disabled={!dirty}>save memory</button>
        <span className="muted">{status}</span>
      </div>
    </div>
  );
}
