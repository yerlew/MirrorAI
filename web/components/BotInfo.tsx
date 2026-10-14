"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RichText } from "@/components/RichText";
import { type Character, compact, creatorName, handleHref, supabase } from "@/lib/supabase";

/** ☆ collect (save) a bot. the creator gets a notification saying you collected it */
export function CollectButton({ c }: { c: Character }) {
  const [me, setMe] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [count, setCount] = useState(c.collect_count);
  useEffect(() => {
    setCount(c.collect_count);
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setMe(auth.user.id);
      const { data } = await supabase.from("collections").select("character_id").eq("character_id", c.id).maybeSingle();
      setOn(!!data);
    })();
  }, [c.id, c.collect_count]);
  async function toggle() {
    if (!me) return void (location.href = "/login");
    if (on && c.limited && !confirm(`${c.name} is limited: its creator deleted it. if you remove it, it's gone for good, chats included. remove anyway?`)) return;
    const next = !on;
    setOn(next);
    setCount((n) => n + (next ? 1 : -1));
    const { error } = next
      ? await supabase.from("collections").insert({ user_id: me, character_id: c.id })
      : await supabase.from("collections").delete().eq("user_id", me).eq("character_id", c.id);
    if (error) { setOn(!next); setCount((n) => n + (next ? -1 : 1)); return alert(error.message); }
    if (!next && c.limited) location.href = "/chats";
  }
  return (
    <button type="button" className={`btn-ghost collect${on ? " on" : ""}`} aria-pressed={on} onClick={toggle} title={on ? "collected" : "collect this bot"}>
      {on ? "★" : "☆"} {on ? "collected" : "collect"}{count > 0 && <span className="muted"> {compact(count)}</span>}
    </button>
  );
}

/** the bot's cover, stats, creator, tags and intro. `side` = right column on the full chat page, otherwise the card at the top of the chat */
export function BotInfo({ c, side }: { c: Character; side?: boolean }) {
  const [mine, setMine] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMine(!!data.user && data.user.id === c.creator_id));
  }, [c.creator_id]);
  async function remove() {
    if (!confirm(`delete ${c.name}? anyone who collected it keeps it as a limited bot. everyone else loses it, and you can't edit it anymore.`)) return;
    const { data, error } = await supabase.rpc("delete_character", { p_id: c.id });
    if (error) return alert(error.message);
    alert(data === "limited" ? `${c.name} is deleted. people who collected it keep it as a limited bot.` : `${c.name} is deleted.`);
    location.href = "/";
  }
  const chips = [...c.traits, ...c.tags.filter((t) => !c.traits.includes(t))];
  return (
    <div className={side ? "bot-info side" : "bot-info"}>
      <div className="cover">
        <span className="letter">{c.name[0]}</span>
        {c.avatar_url && <img src={c.avatar_url} alt="" className={c.nsfw_cover ? "blur" : undefined} />}
      </div>
      <div className="bot-info-body">
        <h2>{c.name}{c.nsfw && <span className="badge">18+</span>}{c.limited && <LimitedBadge />}</h2>
        <div className="stats">
          <span title="messages sent">💬 {compact(c.message_count)}</span>
          <span title="people who've chatted">👤 {compact(c.user_count)}</span>
        </div>
        <span className="muted">by {c.creator_handle ? <Link href={handleHref(c.creator_handle)} style={{ color: "var(--accent)" }}>@{c.creator_handle}</Link> : creatorName(c)}</span>
        {chips.length > 0 && <div className="tags">{chips.slice(0, side ? 20 : 8).map((t) => <span key={t} className="tag">{t}</span>)}</div>}
        {(c.intro || c.tagline) && <div className="intro"><RichText text={c.intro || c.tagline || ""} /></div>}
        <div className="row" style={{ gap: 6 }}>
          <CollectButton c={c} />
          {mine && !c.limited && <button type="button" className="btn-ghost danger" onClick={remove}>delete bot</button>}
        </div>
      </div>
    </div>
  );
}

export function LimitedBadge() {
  return <span className="badge limited" title="its creator deleted it. only people who collected it still have it">limited</span>;
}
