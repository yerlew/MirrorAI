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
