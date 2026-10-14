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
