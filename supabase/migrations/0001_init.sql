-- Julio's Speaking Trainer: initial schema (SPEC 12).
--
-- Only the server functions touch this database, with the secret key, which
-- maps to the `service_role` role. New Supabase projects stopped exposing new
-- public tables to the Data API by default on 2026-05-30 (SPEC 4), so every
-- grant is explicit. RLS is on with no policies: the anon and authenticated
-- roles can't read or write anything.
--
-- Run once in the Supabase SQL Editor (HUMAN_GUIDE Stage 6b). It is safe to
-- run again: everything is "if not exists" / "or replace".

-- ---- tables -----------------------------------------------------------------

create table if not exists public.profile (
  id smallint primary key default 1 check (id = 1),
  level smallint not null default 2 check (level between 1 and 3),
  ielts_test_date date,
  pause_p90 integer,
  placement_done boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.profile (id) values (1) on conflict (id) do nothing;

create table if not exists public.sessions (
  id uuid primary key,
  started_at timestamptz not null,
  exam text not null check (exam in ('ielts', 'clinical', 'toefl')),
  mode text not null,
  level smallint not null check (level between 1 and 3),
  season text,
  topic_ids text[] not null default '{}',
  transcript jsonb not null,
  metrics jsonb not null default '{}',
  grade jsonb,
  overall numeric(3, 1),
  saved_at timestamptz not null default now()
);
create index if not exists sessions_started_at_idx on public.sessions (started_at desc);

create table if not exists public.vocab (
  word text primary key check (word = lower(word) and length(word) between 1 and 60),
  es text not null,
  example text not null default '',
  exam_tags text[] not null default '{ielts}',
  nclex_area text not null default 'none',
  first_seen_session uuid,
  times_seen integer not null default 0,
  times_used_correctly integer not null default 0,
  mastered boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.case_flags (
  id bigint generated always as identity primary key,
  case_id text not null,
  session_id uuid,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.usage (
  day date primary key,
  sessions integer not null default 0
);

create table if not exists public.heartbeat (
  id smallint primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
insert into public.heartbeat (id) values (1) on conflict (id) do nothing;

alter table public.profile enable row level security;
alter table public.sessions enable row level security;
alter table public.vocab enable row level security;
alter table public.case_flags enable row level security;
alter table public.usage enable row level security;
alter table public.heartbeat enable row level security;

-- ---- functions ------------------------------------------------------------------

-- "Today" is Julio's day in Mexico, so the daily cap resets at his midnight.
create or replace function public.julio_today() returns date
language sql stable as $$ select (now() at time zone 'America/Mexico_City')::date $$;

-- The one database round trip in /api/session-start (SPEC 9): today's graded
-- sessions, recent topic ids, the profile, saved words due for review, and
-- the last full test's overall.
create or replace function public.session_start_info() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'today', coalesce((select sessions from public.usage where day = public.julio_today()), 0),
    'recent_part1', coalesce((
      select jsonb_agg(t) from (
        select unnest(topic_ids) as t from (
          select topic_ids from public.sessions where exam = 'ielts' order by started_at desc limit 5
        ) s
      ) u), '[]'::jsonb),
    'recent_part2', coalesce((
      select jsonb_agg(t) from (
        select unnest(topic_ids) as t from (
          select topic_ids from public.sessions where exam = 'ielts' order by started_at desc limit 10
        ) s
      ) u), '[]'::jsonb),
    'profile', (select to_jsonb(p) from public.profile p where id = 1),
    'due_words', coalesce((
      select jsonb_agg(jsonb_build_object('word', word, 'es', es)) from (
        select word, es from public.vocab where not mastered
        order by times_used_correctly, times_seen, created_at limit 30
      ) v), '[]'::jsonb),
    'last_full', (
      select jsonb_build_object('overall', overall, 'started_at', started_at)
      from public.sessions
      where exam = 'ielts' and mode = 'full' and overall is not null
      order by started_at desc limit 1)
  )
$$;

-- /api/grade (SPEC 4): one atomic increment-and-check before calling the
-- model. Returns the count after this grade and whether it is within the cap;
-- a refused grade is not counted.
create or replace function public.grade_admit(cap integer) returns jsonb
language plpgsql as $$
declare
  n integer;
begin
  insert into public.usage (day, sessions) values (public.julio_today(), 1)
  on conflict (day) do update set sessions = public.usage.sessions + 1
  returning sessions into n;
  if n > cap then
    update public.usage set sessions = sessions - 1 where day = public.julio_today();
    return jsonb_build_object('allowed', false, 'count', n - 1);
  end if;
  return jsonb_build_object('allowed', true, 'count', n);
end
$$;

-- /api/sessions: upsert by the client's uuid (retries are safe). The first
-- time a session arrives with a grade, count saved-word reviews toward
-- mastery (3 correct uses marks a word mastered). Also stores pause_p90 for
-- the next session's endpointing.
create or replace function public.save_session(s jsonb) returns jsonb
language plpgsql as $$
declare
  sid uuid := (s->>'id')::uuid;
  had_grade boolean;
begin
  select grade is not null into had_grade from public.sessions where id = sid;

  insert into public.sessions (id, started_at, exam, mode, level, season, topic_ids, transcript, metrics, grade, overall, saved_at)
  values (
    sid,
    (s->>'started_at')::timestamptz,
    s->>'exam',
    s->>'mode',
    (s->>'level')::smallint,
    s->>'season',
    coalesce(array(select jsonb_array_elements_text(s->'topic_ids')), '{}'),
    s->'transcript',
    coalesce(s->'metrics', '{}'::jsonb),
    case when s->'grade' is null or jsonb_typeof(s->'grade') = 'null' then null else s->'grade' end,
    (s->>'overall')::numeric,
    now()
  )
  on conflict (id) do update set
    transcript = excluded.transcript,
    metrics = excluded.metrics,
    -- A later save without a grade never erases one.
    grade = coalesce(excluded.grade, public.sessions.grade),
    overall = coalesce(excluded.overall, public.sessions.overall),
    saved_at = now();

  if not coalesce(had_grade, false) and s->'grade' is not null and jsonb_typeof(s->'grade') = 'object' then
    update public.vocab set times_seen = times_seen + 1
    where word in (select lower(jsonb_array_elements_text(coalesce(s->'due_words', '[]'::jsonb))));
    update public.vocab set
      times_used_correctly = times_used_correctly + 1,
      mastered = mastered or times_used_correctly + 1 >= 3
    where word in (select lower(jsonb_array_elements_text(coalesce(s->'grade'->'saved_words_used', '[]'::jsonb))));
  end if;

  if s->>'pause_p90' is not null then
    update public.profile set pause_p90 = (s->>'pause_p90')::integer, updated_at = now() where id = 1;
  end if;

  return jsonb_build_object('ok', true);
end
$$;

-- /api/keepalive (daily Vercel Cron): free projects pause after 7 days of
-- low activity (SPEC 4).
create or replace function public.keepalive() returns timestamptz
language sql as $$
  update public.heartbeat set beat_at = now() where id = 1 returning beat_at
$$;

-- ---- grants (SPEC 4: explicit, for the role the server key uses) -----------------

grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.profile, public.sessions, public.vocab, public.case_flags, public.usage, public.heartbeat
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.julio_today(), public.session_start_info(), public.grade_admit(integer),
  public.save_session(jsonb), public.keepalive() from public, anon, authenticated;
grant execute on function public.julio_today(), public.session_start_info(), public.grade_admit(integer),
  public.save_session(jsonb), public.keepalive() to service_role;
