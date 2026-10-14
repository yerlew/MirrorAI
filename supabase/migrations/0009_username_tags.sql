-- usernames: anything goes (case kept, spaces and symbols fine), except '#' and control characters.
-- names don't have to be unique; everyone gets a #tag per name instead, like Yerlew#1.
-- tags count up shortest-first: 1..9, then 01..99, then 001..999, then 0001.., so "1" and "01" are different tags.
alter table public.profiles drop constraint profiles_username_key;
alter table public.profiles drop constraint username_format;
alter table public.profiles add constraint username_format
  check (username is null or (char_length(username) between 1 and 32 and username = btrim(username) and username !~ '[#[:cntrl:]]'));
alter table public.profiles add column tag_index integer, add column handle text;
create unique index profiles_name_tag on public.profiles (lower(username), tag_index);
create unique index profiles_handle on public.profiles (handle);

-- nth tag for a name: 1→"1" … 9→"9", 10→"01" … 108→"99", 109→"001" …
create function public.tag_for(n integer) returns text language plpgsql immutable as $$
declare
  len integer := 1;
  cap bigint := 9;
  k bigint := n;
begin
  if n is null or n < 1 then
    return null;
  end if;
  while k > cap loop
    k := k - cap;
    len := len + 1;
    cap := (10::bigint ^ len)::bigint - 1;
  end loop;
  return lpad(k::text, len, '0');
end $$;

-- tags are only ever handed out here: a new or changed name gets the next free tag for that name
create function public.assign_tag() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.username is null then
    new.tag_index := null;
  elsif tg_op = 'UPDATE' and lower(old.username) is not distinct from lower(new.username) then
    new.tag_index := old.tag_index; -- same name (maybe different capitalization) keeps its tag
  else
    perform pg_advisory_xact_lock(hashtext(lower(new.username)));
    select coalesce(max(tag_index), 0) + 1 into new.tag_index from profiles where lower(username) = lower(new.username);
  end if;
  new.handle := case when new.username is null then null else new.username || '#' || tag_for(new.tag_index) end;
  return new;
end $$;
create trigger assign_tag before insert or update on public.profiles
  for each row execute function public.assign_tag();

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
