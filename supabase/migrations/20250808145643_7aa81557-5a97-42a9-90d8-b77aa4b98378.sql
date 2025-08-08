-- Ensure pgcrypto for UUIDs
create extension if not exists pgcrypto with schema public;

-- Cinemas table
create table if not exists public.cinemas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Films table
create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  year int,
  runtime_mins int,
  created_at timestamptz not null default now()
);

-- Screenings table
create table if not exists public.screenings (
  id uuid primary key default gen_random_uuid(),
  cinema_id uuid not null references public.cinemas(id) on delete cascade,
  film_id uuid not null references public.films(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  screen text,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_cinemas_name on public.cinemas (name);
create index if not exists idx_screenings_start_time on public.screenings (start_time);
create index if not exists idx_screenings_cinema_id on public.screenings (cinema_id);
create index if not exists idx_screenings_film_id on public.screenings (film_id);

-- Enable RLS
alter table public.cinemas enable row level security;
alter table public.films enable row level security;
alter table public.screenings enable row level security;

-- Public read policies
create policy if not exists "Public can read cinemas"
  on public.cinemas for select
  to anon, authenticated
  using (true);

create policy if not exists "Public can read films"
  on public.films for select
  to anon, authenticated
  using (true);

create policy if not exists "Public can read screenings"
  on public.screenings for select
  to anon, authenticated
  using (true);
