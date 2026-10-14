"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Character, supabase } from "@/lib/supabase";

export default function Browse() {
  const [chars, setChars] = useState<Character[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let query = supabase.from("characters").select("*").eq("visibility", "public").order("chat_count", { ascending: false }).limit(60);
    if (q.trim()) query = query.ilike("name", `%${q.trim()}%`);
    query.then(({ data }) => setChars((data as Character[]) ?? []));
  }, [q]);

  return (
    <main>
      <input placeholder="search characters" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />
      <div className="grid">
        {chars.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className="card">
            {c.avatar_url ? <img className="avatar" src={c.avatar_url} alt="" /> : <div className="avatar">{c.name[0]}</div>}
            <strong>{c.name}</strong>
            <span className="muted">{c.tagline}</span>
            <span className="muted">{c.chat_count.toLocaleString()} chats</span>
          </Link>
        ))}
      </div>
      {chars.length === 0 && <p className="muted">no characters yet. <Link href="/create">make the first one</Link>.</p>}
    </main>
  );
}
