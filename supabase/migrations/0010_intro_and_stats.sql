-- the intro is the creator's pitch for the bot: shown on its thumbnail and at the top of the chat.
-- message_count / user_count are public totals (messages sent to the bot, people who've chatted with it);
-- they're counters only, so creators still can't see who chatted or what was said.
alter table public.characters
  add column intro text not null default '' check (char_length(intro) <= 2000),
  add column message_count bigint not null default 0,
  add column user_count integer not null default 0;

update public.characters c set
  message_count = (select count(*) from public.messages m join public.chats ch on ch.id = m.chat_id where ch.character_id = c.id and m.role = 'user'),
  user_count = (select count(distinct ch.user_id) from public.chats ch where ch.character_id = c.id);

create function public.bump_message_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'user' then
    update characters set message_count = message_count + 1
    where id = (select character_id from chats where id = new.chat_id);
  end if;
  return new;
end $$;
create trigger on_message_created after insert on public.messages
  for each row execute function public.bump_message_count();

-- a restart makes a new chat row, so only count someone the first time they chat with a bot
create function public.bump_user_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from chats where character_id = new.character_id and user_id = new.user_id) then
    update characters set user_count = user_count + 1 where id = new.character_id;
  end if;
  return new;
end $$;
-- before insert, so the new row itself isn't visible yet
create trigger on_chat_created_count_user before insert on public.chats
  for each row execute function public.bump_user_count();

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.canon_context, c.real_person,
  case when c.anonymous then null else p.handle end as creator_handle,
  c.intro, c.message_count, c.user_count
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();

-- collections: people save ("collect") bots they like. who collected what is private to the collector,
-- except that the bot's creator gets a notification naming who collected it (like polybuzz).
create table public.collections (
  user_id uuid not null references public.profiles on delete cascade,
  character_id uuid not null references public.characters on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
alter table public.collections enable row level security;
create policy "own collections" on public.collections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.characters add column collect_count integer not null default 0;

-- notifications for creators: someone collected your bot, someone followed you
create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('collect', 'follow')),
  actor_id uuid not null references public.profiles on delete cascade,
  character_id uuid references public.characters on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;
create policy "read own notifications" on public.notifications for select using (recipient_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "clear own notifications" on public.notifications for delete using (recipient_id = auth.uid());

create function public.on_collect() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  if tg_op = 'INSERT' then
    update characters set collect_count = collect_count + 1 where id = new.character_id returning creator_id into owner;
    if owner is not null and owner <> new.user_id then
      insert into notifications (recipient_id, kind, actor_id, character_id) values (owner, 'collect', new.user_id, new.character_id);
    end if;
    return new;
  end if;
  update characters set collect_count = greatest(collect_count - 1, 0) where id = old.character_id;
  return old;
end $$;
create trigger on_collect after insert or delete on public.collections
  for each row execute function public.on_collect();

create function public.on_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (recipient_id, kind, actor_id) values (new.followee_id, 'follow', new.follower_id);
  return new;
end $$;
create trigger on_follow after insert on public.follows
  for each row execute function public.on_follow();

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.canon_context, c.real_person,
  case when c.anonymous then null else p.handle end as creator_handle,
  c.intro, c.message_count, c.user_count, c.collect_count
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();
