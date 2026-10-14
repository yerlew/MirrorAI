-- discovery filters for the for-you feed: gender tabs, category chips, and the "no ai art" switch

alter table public.characters
  add column gender text check (gender in ('male', 'female', 'nonbinary')),
  add column categories text[] not null default '{}',
  add column ai_art boolean not null default false, -- creator says the avatar was ai-generated
  add column art_credit text check (char_length(art_credit) <= 120); -- the human artist, when there is one

create index characters_categories on public.characters using gin (categories);
