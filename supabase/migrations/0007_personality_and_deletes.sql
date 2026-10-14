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
