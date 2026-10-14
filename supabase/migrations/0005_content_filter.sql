-- the nsfw switch becomes a three-way browsing filter: sfw (non-nsfw only), any, or nsfw (18+ only).
-- it's a preference for what shows up; opening an 18+ bot is gated on the adult confirmation instead.
alter table public.profiles add column content_filter text not null default 'sfw' check (content_filter in ('sfw', 'any', 'nsfw'));
update public.profiles set content_filter = 'any' where show_nsfw;
alter table public.profiles drop constraint nsfw_needs_adult;
alter table public.profiles drop column show_nsfw;
alter table public.profiles add constraint filter_needs_adult check (content_filter = 'sfw' or adult_confirmed_at is not null);
