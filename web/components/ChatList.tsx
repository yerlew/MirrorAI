"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LimitedBadge } from "@/components/BotInfo";
import { type Character, supabase } from "@/lib/supabase";

export const CHATS_CHANGED = "mirror:chats-changed";

type Row = { character: Character; updated_at: string };

/** every bot you've talked to, newest first. only you can see this list. */
export function ChatList({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const pathname = usePathname();

  async function load() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setRows([]);
    const { data: chats } = await supabase.from("chats").select("character_id, updated_at").order("updated_at", { ascending: false }).limit(500);
    const latest = new Map<string, string>();
    for (const c of chats ?? []) if (!latest.has(c.character_id)) latest.set(c.character_id, c.updated_at);
    if (!latest.size) return setRows([]);
    const { data: cards } = await supabase.from("character_cards").select("*").in("id", [...latest.keys()]);
    const byId = new Map((cards as Character[] ?? []).map((c) => [c.id, c]));
    setRows([...latest].flatMap(([id, updated_at]) => (byId.has(id) ? [{ character: byId.get(id)!, updated_at }] : [])));
  }

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(CHATS_CHANGED, onChange);
    return () => window.removeEventListener(CHATS_CHANGED, onChange);
  }, []);

  async function remove(c: Character) {
    if (!confirm(`delete all your chats with ${c.name}? the history is gone for good.`)) return;
    await supabase.from("chats").delete().eq("character_id", c.id);
    setRows((r) => r?.filter((x) => x.character.id !== c.id) ?? null);
    if (pathname === `/c/${c.id}`) location.reload();
  }

  if (rows === null) return null;
  if (!rows.length) return <p className="muted" style={{ padding: "0 8px" }}>bots you chat with show up here</p>;

  return (
    <ul className={`chatlist${compact ? " compact" : ""}`}>
      {rows.map(({ character: c, updated_at }) => (
        <li key={c.id} className={pathname === `/c/${c.id}` ? "active" : ""}>
          <Link href={`/c/${c.id}`}>
            <span className="mini-avatar">{c.avatar_url && !c.nsfw_cover ? <img src={c.avatar_url} alt="" /> : c.name[0]}</span>
            <span className="chatlist-text">
              <strong>{c.name}{c.limited && <LimitedBadge />}</strong>
              <span className="muted">{new Date(updated_at).toLocaleDateString()}</span>
            </span>
          </Link>
          <button className="chatlist-delete" title={`delete chats with ${c.name}`} onClick={() => remove(c)}>×</button>
        </li>
      ))}
    </ul>
  );
}
