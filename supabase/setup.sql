-- Mirror AI database setup: paste this whole file into Supabase → SQL Editor → New query, then hit Run.
-- Run it ONCE on an empty database. Generated from supabase/migrations 0001-0012.
begin;

-- ===== 0001_init.sql =====
-- core schema for mirror ai: profiles, characters, chats, messages

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  tagline text check (char_length(tagline) <= 140),
  avatar_url text,
  greeting text not null default '',
  persona text not null check (char_length(persona) <= 8000), -- who the character is, how they talk
  scenario text not null default '',                           -- optional starting situation
  tags text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  chat_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index characters_public_popular on public.characters (chat_count desc) where visibility = 'public';

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  character_id uuid not null references public.characters on delete cascade,
  memory text not null default '',      -- rolling long-term summary, kept by the chat function
  memory_through bigint not null default 0, -- last message id folded into memory
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index chats_user_recent on public.chats (user_id, updated_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  chat_id uuid not null references public.chats on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index messages_chat on public.messages (chat_id, id);

-- new auth user -> profile row
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- new chat -> bump character popularity
create function public.bump_chat_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.characters set chat_count = chat_count + 1 where id = new.character_id;
  return new;
end $$;
create trigger on_chat_created after insert on public.chats
  for each row execute function public.bump_chat_count();

-- row level security
alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;

create policy "profiles are readable" on public.profiles for select using (true);
create policy "own profile is editable" on public.profiles for update using (auth.uid() = id);

create policy "public or own characters are readable" on public.characters for select
  using (visibility in ('public', 'unlisted') or creator_id = auth.uid());
create policy "create own characters" on public.characters for insert with check (creator_id = auth.uid());
create policy "edit own characters" on public.characters for update using (creator_id = auth.uid());
create policy "delete own characters" on public.characters for delete using (creator_id = auth.uid());

create policy "own chats" on public.chats for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- clients read their messages; writes go through the chat edge function (service role)
create policy "read own messages" on public.messages for select
  using (exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid()));

-- ===== 0002_discovery.sql =====
-- discovery filters for the for-you feed: gender tabs, category chips, and the "no ai art" switch

alter table public.characters
  add column gender text check (gender in ('male', 'female', 'nonbinary')),
  add column categories text[] not null default '{}',
  add column ai_art boolean not null default false, -- creator says the avatar was ai-generated
  add column art_credit text check (char_length(art_credit) <= 120); -- the human artist, when there is one

create index characters_categories on public.characters using gin (categories);

-- ===== 0003_personas.sql =====
-- personas: private "who i am in this chat" profiles, picked once when a chat starts.
-- the main profile (profiles.display_name / username) stays the public identity for comments and bot credits.

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  backstory text not null default '' check (char_length(backstory) <= 4000),
  avatar_url text,
  created_at timestamptz not null default now()
);
create index personas_user on public.personas (user_id, created_at);

-- extra backstory a persona has with one specific bot only (persona A + backstory C, just for bot X)
create table public.persona_overrides (
  persona_id uuid not null references public.personas on delete cascade,
  character_id uuid not null references public.characters on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  extra_backstory text not null default '' check (char_length(extra_backstory) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (persona_id, character_id)
);

-- null persona = chat as your main profile name
alter table public.chats add column persona_id uuid references public.personas on delete set null;

alter table public.personas enable row level security;
alter table public.persona_overrides enable row level security;

-- private to their owner, never readable by anyone else
create policy "own personas" on public.personas for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own persona overrides" on public.persona_overrides for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.personas p where p.id = persona_id and p.user_id = auth.uid()));

-- profile names are the public identity; keep usernames sane
alter table public.profiles add constraint username_format check (username ~ '^[a-z0-9_]{3,24}$');
create policy "own profile is insertable" on public.profiles for insert with check (auth.uid() = id);

-- ===== 0004_privacy_nsfw_creators.sql =====
-- memory you can edit, imports, nsfw labels, anonymous posting, creator profiles + follows, reports

-- facts the user pins for a chat; the model reads them every turn but never rewrites them
alter table public.chats add column pinned text not null default '' check (char_length(pinned) <= 4000);

-- imported chats bring their own history, written by the owner
create policy "insert into own chats" on public.messages for insert
  with check (exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid()));

alter table public.characters
  add column nsfw boolean not null default false,       -- the bot itself is adult
  add column nsfw_cover boolean not null default false, -- the cover image is adult
  add column anonymous boolean not null default false,  -- hide the creator on public listings
  add column imported_from text;                         -- e.g. 'chara_card_v2', 'mirrorai'

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 500),
  add column show_nsfw boolean not null default false,
  add column adult_confirmed_at timestamptz;            -- self-declared 18+, required before show_nsfw
alter table public.profiles add constraint nsfw_needs_adult check (not show_nsfw or adult_confirmed_at is not null);

-- privacy: raw character rows (with creator_id) are only readable by their creator now.
-- everyone else reads character_cards, which drops the creator for anonymous bots.
drop policy "public or own characters are readable" on public.characters;
create policy "own characters are readable" on public.characters for select using (creator_id = auth.uid());

create view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();
grant select on public.character_cards to anon, authenticated;

-- follows: who follows whom is private to the follower; counts are public via creator_profiles
create table public.follows (
  follower_id uuid not null references public.profiles on delete cascade,
  followee_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
alter table public.follows enable row level security;
create policy "own follows" on public.follows for all
  using (follower_id = auth.uid()) with check (follower_id = auth.uid());

create view public.creator_profiles as
select
  p.id, p.username, p.display_name, p.avatar_url, p.bio, p.created_at,
  (select count(*) from public.follows f where f.followee_id = p.id) as follower_count,
  (select count(*) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as bot_count,
  (select coalesce(sum(c.chat_count), 0) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as total_chats
from public.profiles p;
grant select on public.creator_profiles to anon, authenticated;

-- reports (app store requires a way to flag user-made content). only the reporter can read their own reports.
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles on delete cascade,
  character_id uuid not null references public.characters on delete cascade,
  reason text not null check (reason in ('mislabeled_nsfw', 'minor_sexualized', 'illegal', 'harassment', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy "file reports" on public.reports for insert with check (reporter_id = auth.uid());
create policy "see own reports" on public.reports for select using (reporter_id = auth.uid());

-- ===== 0005_content_filter.sql =====
-- the nsfw switch becomes a three-way browsing filter: sfw (non-nsfw only), any, or nsfw (18+ only).
-- it's a preference for what shows up; opening an 18+ bot is gated on the adult confirmation instead.
alter table public.profiles add column content_filter text not null default 'sfw' check (content_filter in ('sfw', 'any', 'nsfw'));
update public.profiles set content_filter = 'any' where show_nsfw;
alter table public.profiles drop constraint nsfw_needs_adult;
alter table public.profiles drop column show_nsfw;
alter table public.profiles add constraint filter_needs_adult check (content_filter = 'sfw' or adult_confirmed_at is not null);

-- ===== 0006_minors_and_providers.sql =====
-- bots whose character is under 18 are always non-nsfw, and can't be flipped back to adult later
alter table public.characters add column minor boolean not null default false;
alter table public.characters add constraint minor_never_nsfw check (not minor or (not nsfw and not nsfw_cover));

create function public.keep_minor_flag() returns trigger language plpgsql as $$
begin
  if old.minor and not new.minor then
    raise exception 'a bot marked under 18 stays under 18';
  end if;
  return new;
end $$;
create trigger keep_minor_flag before update on public.characters
  for each row execute function public.keep_minor_flag();

-- age checks are off for now (2026-10-14, zero users). adult_confirmed_at stays for when they come back.
alter table public.profiles drop constraint filter_needs_adult;

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();

-- ===== 0007_personality_and_deletes.sql =====
-- personality that holds up over long chats: background, core traits, quirks with how often they show, and how fast
-- the bot warms up to the user. the chat function re-reads all of it before every reply.
alter table public.characters
  add column background text not null default '' check (char_length(background) <= 8000),
  add column traits text[] not null default '{}' check (cardinality(traits) <= 20),
  add column quirks jsonb not null default '[]' check (jsonb_typeof(quirks) = 'array' and jsonb_array_length(quirks) <= 20),
  add column warmup text not null default 'slow' check (warmup in ('never', 'slow', 'normal'));

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();

-- delete a message and everything after it in that chat. if any of it was already folded into memory, the memory is
-- reset so the chat function rebuilds it from the messages that are left.
create function public.delete_messages_from(p_message_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_chat uuid;
begin
  select m.chat_id into v_chat from messages m join chats c on c.id = m.chat_id
  where m.id = p_message_id and c.user_id = auth.uid();
  if v_chat is null then
    raise exception 'message not found';
  end if;
  delete from messages where chat_id = v_chat and id >= p_message_id;
  update chats set memory = '', memory_through = 0 where id = v_chat and memory_through >= p_message_id;
end $$;
revoke execute on function public.delete_messages_from(bigint) from public, anon;
grant execute on function public.delete_messages_from(bigint) to authenticated;

-- ===== 0008_canon.sql =====
-- bots based on an existing character or a real person: where they're from, and how closely to stick to it.
-- canon 0 = loose / alternate universe, 100 = strict canon. the model draws on what it knows about the source.
alter table public.characters
  add column canon_source text not null default '' check (char_length(canon_source) <= 200),
  add column canon smallint not null default 50 check (canon between 0 and 100),
  -- which part of the source to take canon from, e.g. "anime, season 2 through the Shibuya arc (ep 41)"
  add column canon_context text not null default '' check (char_length(canon_context) <= 2000),
  add column real_person boolean not null default false;
-- sexual content about real people is a legal minefield (deepfake / likeness laws), so real-person bots stay non-nsfw
alter table public.characters add constraint real_person_never_nsfw check (not real_person or not nsfw);

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.canon_context, c.real_person
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();

-- ===== 0009_username_tags.sql =====
-- usernames: anything goes (case kept, spaces and symbols fine), except '#' and control characters.
-- names don't have to be unique. instead every account gets a permanent number tag, like a license plate:
-- one count for the whole site, in signup order, shortest-first: 0..9, then 00..99, then 000..999, and so on.
-- the very first account is #0. the tag never changes, even when the username does.
alter table public.profiles drop constraint profiles_username_key;
alter table public.profiles drop constraint username_format;
alter table public.profiles add constraint username_format
  check (username is null or (char_length(username) between 1 and 32 and username = btrim(username) and username !~ '[#[:cntrl:]]'));
alter table public.profiles add column tag_index integer, add column tag text, add column handle text;
create unique index profiles_tag_index on public.profiles (tag_index);
create unique index profiles_handle on public.profiles (handle);

-- nth tag (0-based): 0→"0" … 9→"9", 10→"00" … 109→"99", 110→"000" …
create function public.tag_for(n integer) returns text language plpgsql immutable as $$
declare
  len integer := 1;
  cap bigint := 10;
  k bigint := n;
begin
  if n is null or n < 0 then
    return null;
  end if;
  while k >= cap loop
    k := k - cap;
    len := len + 1;
    cap := (10::bigint ^ len)::bigint;
  end loop;
  return lpad(k::text, len, '0');
end $$;

-- existing accounts get tags in the order they signed up
with ordered as (select id, row_number() over (order by created_at, id) - 1 as n from public.profiles)
update public.profiles p set tag_index = o.n from ordered o where o.id = p.id;

-- tags are only ever handed out here, once per account; nobody can pick or change theirs
create function public.assign_tag() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('profile_tags'));
    select coalesce(max(tag_index), -1) + 1 into new.tag_index from profiles;
  else
    new.tag_index := old.tag_index;
  end if;
  new.tag := tag_for(new.tag_index);
  new.handle := case when new.username is null then null else new.username || '#' || new.tag end;
  return new;
end $$;
create trigger assign_tag before insert or update on public.profiles
  for each row execute function public.assign_tag();
update public.profiles set id = id; -- fill tag + handle for existing rows
alter table public.profiles alter column tag_index set not null;

-- sign-up passes display_name + username in the auth metadata
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[#[:cntrl:]]', '', 'g')), 32);
begin
  insert into public.profiles (id, display_name, username) values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    nullif(wanted, '')
  );
  return new;
end $$;

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.canon_context, c.real_person,
  case when c.anonymous then null else p.handle end as creator_handle
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();

create or replace view public.creator_profiles as
select
  p.id, p.username, p.display_name, p.avatar_url, p.bio, p.created_at,
  (select count(*) from public.follows f where f.followee_id = p.id) as follower_count,
  (select count(*) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as bot_count,
  (select coalesce(sum(c.chat_count), 0) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as total_chats,
  p.handle
from public.profiles p;

-- ===== 0010_intro_and_stats.sql =====
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

-- ===== 0011_limited_bots.sql =====
-- limited bots: when a creator deletes a bot that people have collected, it isn't wiped.
-- everyone who collected it keeps it (and keeps chatting), with a "limited" badge. nobody new can find or collect it.
-- when a collector removes a limited bot it's gone for them for good, and once the last collector lets go the bot is deleted.
alter table public.characters add column deleted_at timestamptz;

-- the creator can't see or edit a bot after deleting it
drop policy "own characters are readable" on public.characters;
create policy "own characters are readable" on public.characters for select using (creator_id = auth.uid() and deleted_at is null);
drop policy "edit own characters" on public.characters;
create policy "edit own characters" on public.characters for update using (creator_id = auth.uid() and deleted_at is null);
-- deleting goes through delete_character() so collectors keep their copy
drop policy "delete own characters" on public.characters;

create function public.delete_character(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from characters where id = p_id and creator_id = auth.uid() and deleted_at is null for update;
  if not found then raise exception 'not your bot'; end if;
  delete from collections where character_id = p_id and user_id = auth.uid();
  if not exists (select 1 from collections where character_id = p_id) then
    delete from characters where id = p_id;
    return 'deleted';
  end if;
  update characters set deleted_at = now() where id = p_id;
  -- people who chatted without collecting lose it, same as a normal delete
  delete from chats where character_id = p_id
    and user_id not in (select user_id from collections where character_id = p_id);
  return 'limited';
end $$;
revoke execute on function public.delete_character(uuid) from public, anon;
grant execute on function public.delete_character(uuid) to authenticated;

create or replace function public.on_collect() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  gone timestamptz;
begin
  if tg_op = 'INSERT' then
    update characters set collect_count = collect_count + 1 where id = new.character_id and deleted_at is null returning creator_id into owner;
    if not found then raise exception 'this bot is limited and can''t be collected anymore'; end if;
    if owner <> new.user_id then
      insert into notifications (recipient_id, kind, actor_id, character_id) values (owner, 'collect', new.user_id, new.character_id);
    end if;
    return new;
  end if;
  update characters set collect_count = greatest(collect_count - 1, 0) where id = old.character_id returning deleted_at into gone;
  if gone is not null then
    -- letting go of a limited bot is permanent
    delete from chats where character_id = old.character_id and user_id = old.user_id;
    if not exists (select 1 from collections where character_id = old.character_id) then
      delete from characters where id = old.character_id;
    end if;
  end if;
  return old;
end $$;

create or replace view public.character_cards as
select
  c.id, c.name, c.tagline, c.avatar_url, c.greeting, c.persona, c.scenario, c.tags, c.visibility, c.chat_count,
  c.gender, c.categories, c.ai_art, c.art_credit, c.nsfw, c.nsfw_cover, c.anonymous, c.created_at,
  case when c.anonymous then null else c.creator_id end as creator_id,
  case when c.anonymous then null else p.display_name end as creator_name,
  case when c.anonymous then null else p.username end as creator_username,
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.canon_context, c.real_person,
  case when c.anonymous then null else p.handle end as creator_handle,
  c.intro, c.message_count, c.user_count, c.collect_count,
  c.deleted_at is not null as limited
from public.characters c
join public.profiles p on p.id = c.creator_id
where (c.deleted_at is null and (c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid()))
   or (c.deleted_at is not null and exists (select 1 from public.collections k where k.character_id = c.id and k.user_id = auth.uid()));

create or replace view public.creator_profiles as
select
  p.id, p.username, p.display_name, p.avatar_url, p.bio, p.created_at,
  (select count(*) from public.follows f where f.followee_id = p.id) as follower_count,
  (select count(*) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous and c.deleted_at is null) as bot_count,
  (select coalesce(sum(c.chat_count), 0) from public.characters c where c.creator_id = p.id and c.visibility = 'public' and not c.anonymous) as total_chats,
  p.handle
from public.profiles p;

-- ===== 0012_profiles_posts_feedback.sql =====
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

commit;
notify pgrst, 'reload schema';
