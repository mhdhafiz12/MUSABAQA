begin;

create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  festival_name varchar(120) not null default 'Kauzariyya Arts Festival 2026',
  festival_date date not null default '2026-07-05',
  intro_video_enabled boolean not null default true,
  intro_video_url varchar(500) not null default 'assets/intro.mp4',
  intro_video_loop boolean not null default false,
  video_darkness smallint not null default 38 check (video_darkness between 0 and 75),
  animations_enabled boolean not null default true,
  scoreboard_live boolean not null default true,
  schedule_blocks jsonb not null default '[{"key":"subahi","label":"Subahi","start_time":"05:00","end_time":"07:00"},{"key":"morning","label":"Morning","start_time":"09:00","end_time":"12:45"},{"key":"afternoon","label":"Afternoon","start_time":"14:30","end_time":"16:30"},{"key":"evening","label":"Evening","start_time":"19:30","end_time":"20:45"},{"key":"night","label":"Night","start_time":"21:30","end_time":"23:00"}]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "Public read site settings" on public.site_settings;
create policy "Public read site settings" on public.site_settings for select using (true);

commit;
