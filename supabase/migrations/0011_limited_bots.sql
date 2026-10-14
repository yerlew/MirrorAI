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
