-- profile page: profile pictures, subscribers, twitter-style posts, and feedback to the app owner

-- accounts made before the db was set up have no profile row yet: make them, in signup order (so the first gets #0)
insert into public.profiles (id, display_name, username)
select u.id,
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1)),
  nullif(left(btrim(regexp_replace(coalesce(u.raw_user_meta_data ->> 'username', ''), '[#[:cntrl:]]', '', 'g')), 32), '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
order by u.created_at;

alter table public.profiles add constraint display_name_length check (char_length(display_name) <= 40);

-- profile pictures: public bucket, each person writes only inside their own folder (<user id>/...)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do nothing;
    execute $p$create policy "upload own avatar" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "replace own avatar" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "delete own avatar" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

-- subscribers: followers who also want a notification when you post a bot or a post.
-- supporters = followers, subscriptions = who you follow. lists stay private, only counts are public.
alter table public.follows add column notify boolean not null default false;

-- posts: short text posts, like twitter. a reply is a post with a parent.
create table public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles on delete cascade,
  parent_id bigint references public.posts on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  like_count integer not null default 0,
  reply_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index posts_recent on public.posts (created_at desc) where parent_id is null;
create index posts_author on public.posts (author_id, created_at desc);
create index posts_replies on public.posts (parent_id, created_at);
alter table public.posts enable row level security;
create policy "posts are public" on public.posts for select using (true);
create policy "write own posts" on public.posts for insert with check (author_id = auth.uid() and like_count = 0 and reply_count = 0);
create policy "delete own posts" on public.posts for delete using (author_id = auth.uid());

create table public.post_likes (
  user_id uuid not null references public.profiles on delete cascade,
  post_id bigint not null references public.posts on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
alter table public.post_likes enable row level security;
create policy "own likes" on public.post_likes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('collect', 'follow', 'new_bot', 'new_post', 'like', 'reply'));
alter table public.notifications add column post_id bigint references public.posts on delete cascade;

create function public.on_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_author uuid;
begin
  if tg_op = 'DELETE' then
    if old.parent_id is not null then
      update posts set reply_count = greatest(reply_count - 1, 0) where id = old.parent_id;
    end if;
    return old;
  end if;
  if new.parent_id is not null then
    update posts set reply_count = reply_count + 1 where id = new.parent_id returning author_id into parent_author;
    if parent_author is not null and parent_author <> new.author_id then
      insert into notifications (recipient_id, kind, actor_id, post_id) values (parent_author, 'reply', new.author_id, new.id);
    end if;
  else
    insert into notifications (recipient_id, kind, actor_id, post_id)
    select f.follower_id, 'new_post', new.author_id, new.id from follows f where f.followee_id = new.author_id and f.notify;
  end if;
  return new;
end $$;
create trigger on_post after insert or delete on public.posts for each row execute function public.on_post();

create function public.on_post_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author uuid;
begin
  if tg_op = 'DELETE' then
    update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  update posts set like_count = like_count + 1 where id = new.post_id returning author_id into author;
  if author <> new.user_id then
    insert into notifications (recipient_id, kind, actor_id, post_id) values (author, 'like', new.user_id, new.post_id);
  end if;
  return new;
end $$;
create trigger on_post_like after insert or delete on public.post_likes for each row execute function public.on_post_like();

-- subscribers hear about new public bots (anonymous ones stay anonymous)
create function public.on_new_bot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'public' and not new.anonymous then
    insert into notifications (recipient_id, kind, actor_id, character_id)
    select f.follower_id, 'new_bot', new.creator_id, new.id from follows f where f.followee_id = new.creator_id and f.notify;
  end if;
  return new;
end $$;
create trigger on_new_bot after insert on public.characters for each row execute function public.on_new_bot();

-- posts with their author, and whether you liked them
create view public.post_cards as
select
  po.id, po.author_id, po.parent_id, po.body, po.like_count, po.reply_count, po.created_at,
  p.display_name as author_name, p.handle as author_handle, p.avatar_url as author_avatar,
  exists (select 1 from public.post_likes l where l.post_id = po.id and l.user_id = auth.uid()) as liked
from public.posts po
join public.profiles p on p.id = po.author_id;

create or replace view public.creator_profiles as
select
  p.id, p.username, p.display_name, p.avatar_url, p.bio, p.created_at,
  (select count(*) from public.follows f where f.followee_id = p.id) as follower_count,
  (select count(*) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous and c.deleted_at is null) as bot_count,
  (select coalesce(sum(c.chat_count), 0) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as total_chats,
  p.handle,
  (select count(*) from public.follows f where f.followee_id = p.id and f.notify) as subscriber_count,
  (select count(*) from public.follows f where f.follower_id = p.id) as following_count,
  (select count(*) from public.posts po where po.author_id = p.id) as post_count
from public.profiles p;

-- feedback goes to the app owner. written by the feedback edge function (which also emails it); nobody can read it through the api.
create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete set null,
  contact text check (char_length(contact) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  page text check (char_length(page) <= 300),
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
