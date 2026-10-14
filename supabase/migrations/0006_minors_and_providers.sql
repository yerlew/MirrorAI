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
