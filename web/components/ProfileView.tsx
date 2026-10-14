"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LimitedBadge } from "@/components/BotInfo";
import { Collection } from "@/components/Collection";
import { FeedbackButton } from "@/components/Feedback";
import { PostFeed } from "@/components/Posts";
import {
  applyContentFilter, blurCover, type Character, compact, type ContentFilter, type CreatorProfile, handleHref, type Profile,
  profileName, supabase, usernameProblem,
} from "@/lib/supabase";

type Tab = "characters" | "posts" | "collection";
const MAX_AVATAR = 5 * 1024 * 1024;

/** a person's page. no handle = your own, with the editor and your collection */
export function ProfileView({ handle }: { handle?: string }) {
  const own = !handle;
  const [creator, setCreator] = useState<CreatorProfile | null | undefined>(undefined);
  const [me, setMe] = useState<Profile | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [bots, setBots] = useState<Character[] | null>(null);
  const [filter, setFilter] = useState<ContentFilter>("sfw");
  const [follow, setFollow] = useState<{ notify: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("characters");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      setCreator(undefined);
      const { data: auth } = await supabase.auth.getUser();
      let mine: Profile | null = null;
      if (auth.user) {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle<Profile>();
        if (error && own) return setLoadError(error.message);
        mine = data;
      } else if (own) return setLoggedOut(true);
      setMe(mine);
      setFilter(mine?.content_filter ?? "sfw");
      const q = supabase.from("creator_profiles").select("*");
      const { data: c, error } = await (own ? q.eq("id", auth.user!.id) : q.eq("handle", handle!)).maybeSingle<CreatorProfile>();
      if (error) return setLoadError(error.message);
      setCreator(c);
      if (!c) return;
      if (own) {
        // your own page shows every bot you made, private and anonymous ones too
        const { data: b } = await supabase.from("characters").select("*").eq("creator_id", c.id).order("created_at", { ascending: false });
        setBots((b as Character[]) ?? []);
      } else {
        const { data: b } = await applyContentFilter(
          supabase.from("character_cards").select("*").eq("creator_id", c.id).eq("visibility", "public").eq("limited", false).order("message_count", { ascending: false }),
          mine?.content_filter ?? "sfw",
        );
        setBots((b as Character[]) ?? []);
        if (mine && mine.id !== c.id) {
          const { data: f } = await supabase.from("follows").select("notify").eq("follower_id", mine.id).eq("followee_id", c.id).maybeSingle();
          setFollow(f);
        }
      }
    })();
  }, [handle, own]);

  async function toggleFollow() {
    if (!creator) return;
    if (!me) return void (location.href = "/login");
    const was = follow;
    setFollow(was ? null : { notify: false });
    setCreator({ ...creator, follower_count: creator.follower_count + (was ? -1 : 1), subscriber_count: creator.subscriber_count - (was?.notify ? 1 : 0) });
    const { error } = was
      ? await supabase.from("follows").delete().eq("follower_id", me.id).eq("followee_id", creator.id)
      : await supabase.from("follows").insert({ follower_id: me.id, followee_id: creator.id });
    if (error) { setFollow(was); setCreator(creator); }
  }

  // subscribing = following + a notification whenever they post a bot or a post
  async function toggleSubscribe() {
    if (!creator) return;
    if (!me) return void (location.href = "/login");
    const notify = !follow?.notify;
    const before = { follow, creator };
    setFollow({ notify });
    setCreator({ ...creator, follower_count: creator.follower_count + (follow ? 0 : 1), subscriber_count: creator.subscriber_count + (notify ? 1 : -1) });
    const { error } = follow
      ? await supabase.from("follows").update({ notify }).eq("follower_id", me.id).eq("followee_id", creator.id)
      : await supabase.from("follows").insert({ follower_id: me.id, followee_id: creator.id, notify });
    if (error) { setFollow(before.follow); setCreator(before.creator); }
  }

  function share() {
    if (!creator?.handle) return;
    navigator.clipboard?.writeText(location.origin + handleHref(creator.handle));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loggedOut) return <main><p>you're not logged in. <Link href="/login" style={{ color: "var(--accent)" }}>log in</Link> or <Link href="/signup" style={{ color: "var(--accent)" }}>sign up</Link></p></main>;
  if (loadError) return <main><p className="error">couldn't load this profile: {loadError}</p></main>;
  if (creator === undefined) return <main className="muted">loading…</main>;
  if (creator === null) return <main className="muted">{own ? "your profile hasn't been set up yet. try logging out and back in." : `no one goes by ${handle}`}</main>;

  const name = profileName(creator) || "unnamed";
  const tabs: Tab[] = own ? ["characters", "posts", "collection"] : ["characters", "posts"];
  return (
    <main className="profile">
      <div className="profile-head">
        <span className="mini-avatar profile-avatar">{creator.avatar_url ? <img src={creator.avatar_url} alt="" /> : name[0]}</span>
        <div className="profile-id">
          <h1>{name}</h1>
          {creator.handle && <span className="muted">{creator.handle}</span>}
          <div className="profile-stats">
            <span><strong>{compact(creator.follower_count)}</strong><span className="muted">Supporters</span></span>
            <span><strong>{compact(creator.subscriber_count)}</strong><span className="muted">Subscribers</span></span>
            <span><strong>{compact(creator.following_count)}</strong><span className="muted">Subscriptions</span></span>
          </div>
        </div>
        <div className="profile-actions">
          {own && <button type="button" className="icon-btn round" title="edit profile" aria-label="edit profile" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>✎</button>}
          <FeedbackButton />
          <button type="button" className="icon-btn round" title={copied ? "link copied" : "copy profile link"} aria-label="copy profile link" onClick={share}>{copied ? "✓" : "🔗"}</button>
          {!own && me?.id !== creator.id && (
            <>
              <button type="button" className={follow ? "btn-ghost" : undefined} onClick={toggleFollow}>{follow ? "supporting" : "support"}</button>
              <button type="button" className={`icon-btn round${follow?.notify ? " on" : ""}`} aria-pressed={!!follow?.notify}
                title={follow?.notify ? "subscribed: you get notified when they post" : "subscribe: get notified when they post"} onClick={toggleSubscribe}>{follow?.notify ? "🔔" : "🔕"}</button>
            </>
          )}
        </div>
      </div>
      {creator.bio && <p className="profile-bio">{creator.bio}</p>}
      {own && editing && me && <ProfileEditor profile={me} onSaved={(p) => { setMe(p); setCreator({ ...creator, display_name: p.display_name, username: p.username, handle: p.handle, bio: p.bio, avatar_url: p.avatar_url }); setEditing(false); }} />}

      <nav className="profile-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "characters" ? "Characters" : t === "posts" ? "Posts" : "Collection"}
          </button>
        ))}
      </nav>

      {tab === "characters" && bots && (
        <>
          <div className="grid">
            {bots.map((c) => (
              <Link key={c.id} href={`/c/${c.id}`} className="card">
                <div className="art">
                  {c.name[0]}
                  {c.avatar_url && <img src={c.avatar_url} alt="" className={blurCover(c, filter) ? "blur" : undefined} />}
                  <span className="count">💬 {compact(c.message_count ?? 0)}</span>
                </div>
                <div className="body">
                  <span className="name">{c.name}{c.limited && <LimitedBadge />}{own && c.visibility !== "public" && <span className="badge">{c.visibility}</span>}{own && c.anonymous && <span className="badge">anon</span>}</span>
                  {(c.intro || c.tagline) && <span className="tagline">{c.intro || c.tagline}</span>}
                  {c.tags?.length > 0 && <div className="tags">{c.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>}
                </div>
              </Link>
            ))}
          </div>
          {bots.length === 0 && <p className="muted">{own ? <>no bots yet. <Link href="/create" style={{ color: "var(--accent)" }}>make one</Link>.</> : "no public bots yet."}</p>}
        </>
      )}
      {tab === "posts" && <div style={{ maxWidth: 640 }}><PostFeed authorId={creator.id} showComposer={own} /></div>}
      {tab === "collection" && own && <Collection />}
    </main>
  );
}

function ProfileEditor({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [p, setP] = useState(profile);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_AVATAR) return setError("profile picture: 5 MB max");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return setError("profile picture: png, jpg, webp or gif");
    setError("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = usernameProblem(p.username ?? "");
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    let avatar_url = p.avatar_url;
    if (file) {
      const path = `${p.id}/${Date.now()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
      if (error) { setBusy(false); return setError(`upload failed: ${error.message}`); }
      avatar_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }
    const { data, error } = await supabase.from("profiles")
      .update({ display_name: p.display_name?.trim() || null, username: p.username?.trim(), bio: p.bio ?? "", avatar_url })
      .eq("id", p.id).select().single<Profile>();
    setBusy(false);
    if (error) return setError(error.message);
    onSaved(data);
  }

  return (
    <form className="panel profile-editor" onSubmit={save}>
      <h2>Edit profile</h2>
      <div className="row" style={{ gap: 14 }}>
        <span className="mini-avatar profile-avatar">{preview || p.avatar_url ? <img src={preview ?? p.avatar_url!} alt="" /> : (p.display_name || "?")[0]}</span>
        <label className="btn-ghost upload">
          change picture
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} hidden />
        </label>
        {(preview || p.avatar_url) && <button type="button" className="btn-ghost" onClick={() => { setFile(null); setPreview(null); setP({ ...p, avatar_url: null }); }}>remove</button>}
      </div>
      <label className="field">name
        <input value={p.display_name ?? ""} maxLength={40} placeholder="what people see on your page" onChange={(e) => setP({ ...p, display_name: e.target.value })} />
      </label>
      <label className="field"><span>nickname{p.tag && <> · you'll be <strong style={{ color: "var(--text)" }}>{(p.username ?? "").trim() || "…"}#{p.tag}</strong></>}</span>
        <input value={p.username ?? ""} maxLength={32} onChange={(e) => setP({ ...p, username: e.target.value })} />
        <span>Anything goes except #. Your #number is permanent, like a license plate: it stays the same if you change your nickname.</span>
      </label>
      <label className="field">bio
        <textarea rows={3} value={p.bio ?? ""} maxLength={500} placeholder="tell people about yourself and your bots" onChange={(e) => setP({ ...p, bio: e.target.value })} />
      </label>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="row"><button disabled={busy}>{busy ? "saving…" : "save"}</button></div>
    </form>
  );
}
