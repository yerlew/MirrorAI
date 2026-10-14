"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RichText } from "@/components/RichText";
import { ago, compact, handleHref, type Post, profileName, supabase } from "@/lib/supabase";

const MAX = 1000;

function Avatar({ p }: { p: Pick<Post, "author_avatar" | "author_name" | "author_handle"> }) {
  return <span className="mini-avatar">{p.author_avatar ? <img src={p.author_avatar} alt="" /> : (p.author_name || p.author_handle || "?")[0]}</span>;
}

/** write a post, or a reply when parentId is set */
export function Composer({ parentId, onPosted, placeholder = "what's happening?" }: { parentId?: number; onPosted: (p: Post) => void; placeholder?: string }) {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  if (me === undefined) return null;
  if (me === null) return <p className="muted"><Link href="/login" style={{ color: "var(--accent)" }}>log in</Link> to post</p>;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.from("posts").insert({ author_id: me, body: text, parent_id: parentId ?? null }).select("id").single();
    if (error) { setBusy(false); return setError(error.message); }
    const { data: card } = await supabase.from("post_cards").select("*").eq("id", data.id).single<Post>();
    setBusy(false);
    setBody("");
    if (card) onPosted(card);
  }

  return (
    <form className="composer-post" onSubmit={post}>
      <textarea rows={parentId ? 2 : 3} value={body} maxLength={MAX} placeholder={placeholder} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(e); }} />
      <div className="row">
        {error && <span className="error">{error}</span>}
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>{body.length > MAX - 100 ? `${MAX - body.length} left` : ""}</span>
        <button disabled={busy || !body.trim()}>{parentId ? "reply" : "post"}</button>
      </div>
    </form>
  );
}

export function PostItem({ p, me, onDeleted, big }: { p: Post; me: string | null; onDeleted?: (id: number) => void; big?: boolean }) {
  const [liked, setLiked] = useState(p.liked);
  const [likes, setLikes] = useState(p.like_count);
  async function like(e: React.MouseEvent) {
    e.preventDefault();
    if (!me) return void (location.href = "/login");
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    const { error } = next
      ? await supabase.from("post_likes").insert({ user_id: me, post_id: p.id })
      : await supabase.from("post_likes").delete().eq("user_id", me).eq("post_id", p.id);
    if (error) { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
  }
  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("delete this post? replies to it go too.")) return;
    const { error } = await supabase.from("posts").delete().eq("id", p.id);
    if (!error) onDeleted?.(p.id);
  }
  const name = profileName({ display_name: p.author_name, handle: p.author_handle }) || "someone";
  return (
    <article className={`post${big ? " big" : ""}`}>
      <Avatar p={p} />
      <div className="post-main">
        <div className="post-head">
          {p.author_handle ? <Link href={handleHref(p.author_handle)}><strong>{name}</strong></Link> : <strong>{name}</strong>}
          {p.author_handle && <span className="muted">{p.author_handle}</span>}
          <span className="muted">· <Link href={`/posts/${p.id}`} title={new Date(p.created_at).toLocaleString()}>{ago(p.created_at)}</Link></span>
          {me === p.author_id && <button type="button" className="icon-btn post-delete" title="delete post" aria-label="delete post" onClick={remove}>🗑</button>}
        </div>
        <Link href={`/posts/${p.id}`} className="post-body"><RichText text={p.body} /></Link>
        <div className="post-actions">
          <Link href={`/posts/${p.id}`} className="post-action" title="replies">💬 {p.reply_count > 0 && compact(p.reply_count)}</Link>
          <button type="button" className={`post-action${liked ? " on" : ""}`} aria-pressed={liked} title={liked ? "unlike" : "like"} onClick={like}>{liked ? "♥" : "♡"} {likes > 0 && compact(likes)}</button>
        </div>
      </div>
    </article>
  );
}

/** a timeline of top-level posts: everyone's, the people you follow, or one person's */
export function PostFeed({ authorId, following, showComposer }: { authorId?: string; following?: boolean; showComposer?: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    setPosts(null);
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setMe(auth.user?.id ?? null);
      let q = supabase.from("post_cards").select("*").is("parent_id", null).order("created_at", { ascending: false }).limit(100);
      if (authorId) q = q.eq("author_id", authorId);
      if (following) {
        if (!auth.user) return setPosts([]);
        const { data: f } = await supabase.from("follows").select("followee_id").eq("follower_id", auth.user.id);
        const ids = (f ?? []).map((r) => r.followee_id as string);
        if (!ids.length) return setPosts([]);
        q = q.in("author_id", ids);
      }
      const { data } = await q;
      setPosts((data as Post[]) ?? []);
    })();
  }, [authorId, following]);
  return (
    <div className="posts">
      {showComposer && <Composer onPosted={(p) => setPosts((ps) => [p, ...(ps ?? [])])} />}
      {posts?.map((p) => <PostItem key={p.id} p={p} me={me} onDeleted={(id) => setPosts((ps) => ps?.filter((x) => x.id !== id) ?? null)} />)}
      {posts && posts.length === 0 && <p className="muted">{following ? "nobody you follow has posted yet." : authorId ? "no posts yet." : "no posts yet. say something."}</p>}
    </div>
  );
}
