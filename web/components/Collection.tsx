"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LimitedBadge } from "@/components/BotInfo";
import { type Character, compact, supabase } from "@/lib/supabase";

/** bots you've collected, newest first. limited ones (deleted by their creator) only live on here */
export function Collection() {
  const [bots, setBots] = useState<Character[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setBots([]);
      const { data: rows } = await supabase.from("collections").select("character_id").order("created_at", { ascending: false });
      const ids = (rows ?? []).map((r) => r.character_id as string);
      if (!ids.length) return setBots([]);
      const { data } = await supabase.from("character_cards").select("*").in("id", ids);
      const byId = new Map(((data as Character[]) ?? []).map((c) => [c.id, c]));
      setBots(ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
    })();
  }, []);
  if (!bots) return null;
  if (!bots.length) return <p className="muted">tap ☆ collect on a bot to keep it here. if its creator ever deletes it, you keep it as a limited bot.</p>;
  return (
    <div className="grid">
      {bots.map((c) => (
        <Link key={c.id} href={`/c/${c.id}`} className={`card${c.limited ? " is-limited" : ""}`}>
          <div className="art">
            {c.name[0]}
            {c.avatar_url && <img src={c.avatar_url} alt="" className={c.nsfw_cover ? "blur" : undefined} />}
            <span className="count">💬 {compact(c.message_count)}</span>
          </div>
          <div className="body">
            <span className="name">{c.name}{c.limited && <LimitedBadge />}</span>
            {(c.intro || c.tagline) && <span className="tagline">{c.intro || c.tagline}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
