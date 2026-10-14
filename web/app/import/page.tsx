"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Imported, type ImportedBot, parseImport } from "@/lib/transfer";
import { supabase } from "@/lib/supabase";

/** our own personality fields from an export, checked since the file could say anything */
function personality(x: ImportedBot["extra"]) {
  if (!x) return {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    background: str(x.background).slice(0, 8000),
    traits: Array.isArray(x.traits) ? x.traits.filter((t) => typeof t === "string").slice(0, 20) : [],
    quirks: Array.isArray(x.quirks)
      ? x.quirks.filter((q) => q && typeof q.text === "string").slice(0, 20)
        .map((q) => ({ text: q.text.slice(0, 200), frequency: ["always", "often", "sometimes", "rarely"].includes(q.frequency) ? q.frequency : "sometimes" }))
      : [],
    warmup: ["never", "slow", "normal"].includes(str(x.warmup)) ? x.warmup : "slow",
    minor: x.minor === true,
    canon_source: str(x.canon_source).slice(0, 200),
    canon: typeof x.canon === "number" ? Math.max(0, Math.min(100, Math.round(x.canon))) : 50,
    canon_context: str(x.canon_context).slice(0, 2000),
    real_person: x.real_person === true,
  };
}

export default function ImportPage() {
  const router = useRouter();
  const [parsed, setParsed] = useState<Imported | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    setError("");
    setParsed(null);
    if (!files?.length) return;
    try {
      // several files merge: e.g. a character card png plus a sillytavern chat log
      const merged: Imported = { bot: null, messages: [] };
      for (const f of Array.from(files)) {
        const r = await parseImport(f);
        if (r.bot && (!merged.bot || (!merged.bot.persona && r.bot.persona))) merged.bot = r.bot;
        if (r.messages.length) Object.assign(merged, { messages: r.messages, memory: r.memory, pinned: r.pinned, memoryCovers: r.memoryCovers });
      }
      if (!merged.bot) throw new Error("no character found. add the character card too.");
      setParsed(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't read that file");
    }
  }

  async function save() {
    if (!parsed?.bot) return;
    setBusy(true);
    setError("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("log in first");
      const { bot } = parsed;
      const { data: character, error: e1 } = await supabase.from("characters").insert({
        creator_id: auth.user.id, name: bot.name, tagline: bot.tagline, persona: bot.persona, scenario: bot.scenario,
        greeting: bot.greeting, tags: bot.tags, visibility: "private", imported_from: bot.source, ...personality(bot.extra),
      }).select("id").single();
      if (e1) throw e1;
      if (parsed.messages.length) {
        const { data: chat, error: e2 } = await supabase.from("chats").insert({
          user_id: auth.user.id, character_id: character.id, memory: parsed.memory ?? "", pinned: parsed.pinned ?? "",
        }).select("id").single();
        if (e2) throw e2;
        const ids: number[] = [];
        for (let i = 0; i < parsed.messages.length; i += 500) {
          const batch = parsed.messages.slice(i, i + 500).map((m) => ({ chat_id: chat.id, role: m.role, content: m.content }));
          const { data: rows, error: e3 } = await supabase.from("messages").insert(batch).select("id");
          if (e3) throw e3;
          ids.push(...rows.map((r) => r.id as number));
        }
        // keep an imported memory summary lined up with the messages it already covers
        if (parsed.memory && parsed.memoryCovers) {
          await supabase.from("chats").update({ memory_through: ids[Math.min(parsed.memoryCovers, ids.length) - 1] }).eq("id", chat.id);
        }
      }
      router.push(`/c/${character.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string }).message ?? e));
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <div className="panel">
        <h2>Import a bot</h2>
        <p className="muted" style={{ margin: 0 }}>
          Bring a character and your chat history from another app. Works with character cards (.png or .json, the format SillyTavern, Chub and most
          card sites use), SillyTavern chat logs (.jsonl, pick it together with the card), and Mirror AI exports. Imported bots are private to you.
        </p>
        <input type="file" multiple accept=".json,.jsonl,.png,application/json,image/png" onChange={(e) => pick(e.target.files)} />
        {parsed?.bot && (
          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <strong>{parsed.bot.name}</strong>
            {parsed.bot.tagline && <span className="muted">{parsed.bot.tagline}</span>}
            <span className="muted">
              {parsed.messages.length ? `${parsed.messages.length.toLocaleString()} messages of chat history` : "no chat history, just the bot"}
              {parsed.memory ? " + saved memory" : ""}
            </span>
            {!parsed.bot.persona && <span className="error">no persona in these files. add the character card for best results, or edit the bot after importing.</span>}
            <div className="row"><button onClick={save} disabled={busy}>{busy ? "importing…" : "import"}</button></div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
