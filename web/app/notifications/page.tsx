"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { handleHref, NOTIFICATIONS_READ, supabase } from "@/lib/supabase";

type Row = {
  id: number;
  kind: "collect" | "follow";
  created_at: string;
  read_at: string | null;
  actor: { display_name: string | null; handle: string | null; avatar_url: string | null } | null;
  character: { id: string; name: string } | null;
};
const KINDS = [
  { key: "all", label: "All" },
  { key: "collect", label: "Collects" },
  { key: "follow", label: "Follows" },
] as const;

export default function Notifications() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("all");
  const [loggedIn, setLoggedIn] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return setLoggedIn(false);
      const { data } = await supabase.from("notifications")
        .select("id, kind, created_at, read_at, actor:profiles!notifications_actor_id_fkey(display_name, handle, avatar_url), character:characters(id, name)")
        .order("created_at", { ascending: false }).limit(200);
      setRows((data as unknown as Row[]) ?? []);
      // opening the tab marks everything read
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    })();
  }, []);

  const shown = (rows ?? []).filter((r) => kind === "all" || r.kind === kind);
  return (
    <main style={{ maxWidth: 680 }}>
      <h1 style={{ fontSize: 24, margin: "8px 0 12px" }}>Notifications</h1>
      {!loggedIn ? (
        <p className="muted"><Link href="/login" style={{ color: "var(--accent)" }}>log in</Link> to see who collected your bots</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Type">
            {KINDS.map((k) => <button key={k.key} className="chip" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
          </div>
          <ul className="notifs">
            {shown.map((n) => {
              const who = n.actor?.display_name || n.actor?.handle || "someone";
              return (
                <li key={n.id} className={n.read_at ? undefined : "unread"}>
                  <span className="mini-avatar">{n.actor?.avatar_url ? <img src={n.actor.avatar_url} alt="" /> : who[0]}</span>
                  <div className="notif-text">
                    <span>
                      {n.actor?.handle ? <Link href={handleHref(n.actor.handle)}><strong>{who}</strong></Link> : <strong>{who}</strong>}
                      {n.kind === "collect" && n.character ? <> collected your character <Link href={`/c/${n.character.id}`} style={{ color: "var(--accent)" }}>@{n.character.name}</Link></> : " followed you"}
                    </span>
                    <span className="muted">{new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows && shown.length === 0 && <p className="muted">nothing yet. when someone collects one of your bots, it shows up here.</p>}
        </>
      )}
    </main>
  );
}
