-- Casting Collection v2 — Postgres schema for Supabase
-- Translated from the existing SQLite schema in server.js (better-sqlite3).
-- Design notes:
--   * INTEGER PRIMARY KEY AUTOINCREMENT  -> GENERATED ALWAYS AS IDENTITY
--   * TEXT                                -> TEXT (unchanged)
--   * datetime('now')                     -> now() (timestamptz)
--   * CHECK constraints carried over as-is
--   * Row Level Security (RLS) is enabled on every table; since this is a
--     small internal team (not a public app), policies simply require the
--     user to be authenticated (logged in via Supabase Auth) — anyone with
--     an account can read/write. This matches current behavior (anyone with
--     access to the desktop app could edit anything).

create extension if not exists "uuid-ossp";

-- ── Settings (single-row key/value store) ─────────────────────────────────
create table if not exists settings (
  key   text primary key,
  value text
);

-- ── Productions ─────────────────────────────────────────────────────────
create table if not exists productions (
  id             bigint generated always as identity primary key,
  name           text not null,
  bg_director    text,
  assistant_name text,
  contact_number text,
  email          text,
  day_rate       text,
  logo_path      text,
  created_at     timestamptz default now()
);

-- ── Agents ──────────────────────────────────────────────────────────────
create table if not exists agents (
  id   bigint generated always as identity primary key,
  name text not null unique
);

-- ── Roles ───────────────────────────────────────────────────────────────
create table if not exists roles (
  id            bigint generated always as identity primary key,
  name          text not null,
  production_id bigint references productions(id) on delete set null,
  unique(name, production_id)
);

-- ── Artists ─────────────────────────────────────────────────────────────
create table if not exists artists (
  id               bigint generated always as identity primary key,
  first_name       text not null,
  last_name        text,
  agent_id         bigint references agents(id) on delete set null,
  agent_name       text,
  role             text,
  day_rate         text,
  fitting_rate     text,
  fitting_date     text,
  shoot_date       text,
  headshot_path    text,
  category         text default 'new',
  phone            text,
  email            text,
  gender           text,
  suburb           text,
  notes            text,
  additional_dates text,
  chest            text,
  waist            text,
  hips             text,
  inseam           text,
  shoe_size        text,
  dress_size       text,
  jacket_size      text,
  shirt_size       text,
  trouser_size     text,
  hat_size         text,
  created_at       timestamptz default now()
);

-- ── Call Sheets ─────────────────────────────────────────────────────────
create table if not exists call_sheets (
  id                bigint generated always as identity primary key,
  type              text not null check (type in ('pencil','fitting','shoot')),
  title             text,
  date              text,
  location          text,
  director_name     text,
  assistant_name    text,
  logo_path         text,
  footer_note       text,
  production_id     bigint references productions(id) on delete set null,
  column_visibility text default '{}',
  created_at        timestamptz default now()
);

-- ── Banners ─────────────────────────────────────────────────────────────
create table if not exists banners (
  id            bigint generated always as identity primary key,
  call_sheet_id bigint not null references call_sheets(id) on delete cascade,
  name          text not null,
  sort_order    integer default 0
);

-- ── Call Sheet Artists (join table) ─────────────────────────────────────
create table if not exists call_sheet_artists (
  id            bigint generated always as identity primary key,
  call_sheet_id bigint not null references call_sheets(id) on delete cascade,
  artist_id     bigint not null references artists(id) on delete cascade,
  banner_id     bigint references banners(id) on delete set null,
  call_time     text,
  report_to     text,
  pickup_time   text,
  pickup_point  text,
  notes         text,
  sort_order    integer default 0,
  unique(call_sheet_id, artist_id)
);

-- ── Pencil Dates ────────────────────────────────────────────────────────
create table if not exists pencil_dates (
  id            bigint generated always as identity primary key,
  name          text not null,
  date          text,
  production_id bigint references productions(id) on delete set null,
  created_at    timestamptz default now()
);

create table if not exists pencil_date_artists (
  pencil_date_id bigint not null references pencil_dates(id) on delete cascade,
  artist_id      bigint not null references artists(id) on delete cascade,
  primary key (pencil_date_id, artist_id)
);

-- ── Fitting Dates ───────────────────────────────────────────────────────
create table if not exists fitting_dates (
  id            bigint generated always as identity primary key,
  day_number    integer,
  date          text,
  name          text,
  production_id bigint references productions(id) on delete set null,
  call_sheet_id bigint references call_sheets(id) on delete set null,
  created_at    timestamptz default now()
);

-- ── Shoot Days ──────────────────────────────────────────────────────────
create table if not exists shoot_days (
  id            bigint generated always as identity primary key,
  day_number    integer,
  date          text,
  name          text,
  production_id bigint references productions(id) on delete set null,
  call_sheet_id bigint references call_sheets(id) on delete set null,
  created_at    timestamptz default now()
);

-- ── Briefs ──────────────────────────────────────────────────────────────
create table if not exists briefs (
  id                   bigint generated always as identity primary key,
  production_id        bigint references productions(id) on delete set null,
  role_name            text,
  age_from             integer,
  age_to               integer,
  gender               text,
  race                 text,
  height_requirements  text,
  costume_requirements text,
  hair_makeup          text,
  restrictions         text,
  scene_description    text,
  fitting_dates        text,
  shoot_dates          text,
  role_rate            text,
  fitting_rate         text,
  mood_board_images    text default '[]',
  created_at           timestamptz default now()
);

-- ── Roles To Fit ────────────────────────────────────────────────────────
create table if not exists roles_to_fit (
  id               bigint generated always as identity primary key,
  role_name        text not null,
  quantity_needed  integer default 1,
  shoot_date       text,
  notes            text,
  created_at       timestamptz default now()
);

-- ── Presentations ───────────────────────────────────────────────────────
create table if not exists presentations (
  id         bigint generated always as identity primary key,
  name       text not null,
  data       text not null,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Z-Cards ─────────────────────────────────────────────────────────────
create table if not exists zcards (
  id           bigint generated always as identity primary key,
  artist_id    bigint references artists(id) on delete cascade,
  display_name text,
  accent_color text default '#f97316',
  photo1       text,
  photo2       text,
  photo3       text,
  photo4       text,
  age          text,
  eye_color    text,
  hair_color   text,
  height       text,
  chest        text,
  bust_size    text,
  waist        text,
  dress_size   text,
  shoe_size    text,
  neck_hat     text,
  suit         text,
  created_at   timestamptz default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────
create index if not exists idx_artists_category      on artists(category);
create index if not exists idx_artists_role          on artists(role);
create index if not exists idx_artists_name          on artists(first_name, last_name);
create index if not exists idx_artists_agent_id      on artists(agent_id);
create index if not exists idx_csa_call_sheet_id     on call_sheet_artists(call_sheet_id);
create index if not exists idx_csa_artist_id         on call_sheet_artists(artist_id);
create index if not exists idx_banners_call_sheet_id on banners(call_sheet_id);
create index if not exists idx_call_sheets_type      on call_sheets(type);
create index if not exists idx_call_sheets_date      on call_sheets(date);
create index if not exists idx_briefs_production_id  on briefs(production_id);
create index if not exists idx_pda_pencil_date_id    on pencil_date_artists(pencil_date_id);

-- ── Row Level Security ──────────────────────────────────────────────────
-- Small internal team app: any signed-in user (you + your 2 assistants)
-- can read/write everything. This mirrors how the app behaves today.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'settings','productions','agents','roles','artists','call_sheets',
      'banners','call_sheet_artists','pencil_dates','pencil_date_artists',
      'fitting_dates','shoot_days','briefs','roles_to_fit','presentations','zcards'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "authenticated_full_access" on %I;', t);
    execute format(
      'create policy "authenticated_full_access" on %I
         for all using (auth.role() = ''authenticated'')
         with check (auth.role() = ''authenticated'');', t
    );
  end loop;
end $$;
