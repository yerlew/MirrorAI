-- bots based on an existing character or a real person: where they're from, and how closely to stick to it.
-- canon 0 = loose / alternate universe, 100 = strict canon. the model draws on what it knows about the source.
alter table public.characters
  add column canon_source text not null default '' check (char_length(canon_source) <= 200),
  add column canon smallint not null default 50 check (canon between 0 and 100),
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
  c.minor, c.background, c.traits, c.quirks, c.warmup, c.canon_source, c.canon, c.real_person
from public.characters c
join public.profiles p on p.id = c.creator_id
where c.visibility in ('public', 'unlisted') or c.creator_id = auth.uid();
