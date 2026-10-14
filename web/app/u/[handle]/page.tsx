"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { applyContentFilter, blurCover, type Character, compact, type ContentFilter, type CreatorProfile, myProfile, profileName, supabase } from "@/lib/supabase";

export default function CreatorPage() {
  const params = useParams<{ handle: string }>();
  // the #tag arrives url-encoded
  const handle = (() => { try { return decodeURIComponent(params.handle); } catch { return params.handle; } })();
  const [creator, setCreator] = useState<CreatorProfile | null | undefined>(undefined);
  const [bots, setBots] = useState<Character[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [filter, setFilter] = useState<ContentFilter>("sfw");

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("creator_profiles").select("*").eq("handle", handle).maybeSingle<CreatorProfile>();
      setCreator(c);
      if (!c) return;
      const profile = await myProfile();
      setMe(profile?.id ?? null);
      setFilter(profile?.content_filter ?? "sfw");
      let q = supabase.from("character_cards").select("*").eq("creator_id", c.id).eq("visibility", "public").eq("limited", false).order("chat_count", { ascending: false });
      q = applyContentFilter(q, profile?.content_filter ?? "sfw");
      const { data: b } = await q;
      setBots((b as Character[]) ?? []);
      if (profile) {
        const { data: f } = await supabase.from("follows").select("followee_id").eq("followee_id", c.id).maybeSingle();
        setFollowing(!!f);
      }
    })();
  }, [handle]);

  async function toggleFollow() {
    if (!creator || !me) return;
    if (following) await supabase.from("follows").delete().eq("followee_id", creator.id);
    else await supabase.from("follows").insert({ follower_id: me, followee_id: creator.id });
    setFollowing(!following);
    setCreator({ ...creator, follower_count: creator.follower_count + (following ? -1 : 1) });
  }

  if (creator === undefined) return <main className="muted">loading…</main>;
  if (creator === null) return <main className="muted">no one goes by {handle}</main>;

  return (
    <main>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 16 }}>
          <span className="mini-avatar" style={{ width: 72, height: 72, fontSize: 28 }}>{creator.avatar_url ? <img src={creator.avatar_url} alt="" /> : (creator.display_name || creator.handle || "?")[0]}</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>{profileName(creator)}</h1>
            {creator.handle && <span className="muted">{creator.handle}</span>}
          </div>
          {me && me !== creator.id && (
            <button style={{ marginLeft: "auto" }} className={following ? "btn-ghost" : undefined} onClick={toggleFollow}>{following ? "following" : "follow"}</button>
          )}
        </div>
        {creator.bio && <p style={{ margin: 0 }}>{creator.bio}</p>}
        <div className="row" style={{ gap: 24 }}>
          <span><strong>{compact(creator.follower_count)}</strong> <span className="muted">followers</span></span>
          <span><strong>{compact(creator.bot_count)}</strong> <span className="muted">bots</span></span>
          <span><strong>{compact(creator.total_chats)}</strong> <span className="muted">chats</span></span>
        </div>
      </div>
      <div className="grid">
        {bots.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className="card">
            <div className="art">
              {c.name[0]}
              {c.avatar_url && <img src={c.avatar_url} alt="" className={blurCover(c, filter) ? "blur" : undefined} />}
              <span className="count">💬 {compact(c.message_count)}</span>
            </div>
            <div className="body">
              <span className="name">{c.name}</span>
              {(c.intro || c.tagline) && <span className="tagline">{c.intro || c.tagline}</span>}
            </div>
          </Link>
        ))}
      </div>
      {bots.length === 0 && <p className="muted">no public bots yet</p>}
    </main>
  );
}
