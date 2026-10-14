"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Composer, PostItem } from "@/components/Posts";
import { type Post, supabase } from "@/lib/supabase";

export default function PostThread() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [parent, setParent] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setMe(auth.user?.id ?? null);
      const { data: p } = await supabase.from("post_cards").select("*").eq("id", Number(id)).maybeSingle<Post>();
      setPost(p);
      if (!p) return;
      if (p.parent_id) {
        const { data: up } = await supabase.from("post_cards").select("*").eq("id", p.parent_id).maybeSingle<Post>();
        setParent(up);
      }
      const { data: r } = await supabase.from("post_cards").select("*").eq("parent_id", p.id).order("created_at").limit(500);
      setReplies((r as Post[]) ?? []);
    })();
  }, [id]);

  if (post === undefined) return <main className="muted">loading…</main>;
  if (post === null) return <main className="muted">this post was deleted. <Link href="/posts" style={{ color: "var(--accent)" }}>back to posts</Link></main>;
  return (
    <main style={{ maxWidth: 640 }}>
      <Link href="/posts" className="muted">← Posts</Link>
      <div className="posts" style={{ marginTop: 12 }}>
        {parent && <PostItem p={parent} me={me} />}
        <PostItem p={post} me={me} big onDeleted={() => (location.href = "/posts")} />
        <Composer parentId={post.id} placeholder="post your reply" onPosted={(p) => setReplies((rs) => [...rs, p])} />
        {replies.map((r) => <PostItem key={r.id} p={r} me={me} onDeleted={(rid) => setReplies((rs) => rs.filter((x) => x.id !== rid))} />)}
      </div>
    </main>
  );
}
