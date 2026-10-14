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
