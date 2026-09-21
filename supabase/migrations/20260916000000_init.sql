-- JobFlow AI - initial schema
-- Run with: supabase db push   (or paste into the Supabase SQL editor)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- plans
create table if not exists public.plans (
  id text primary key,
  name text not null,
  monthly_applications integer not null,
  daily_ai_answers integer not null,
  price_cents integer not null default 0,
  is_public boolean not null default true,
  sort_order integer not null default 0
);

insert into public.plans (id, name, monthly_applications, daily_ai_answers, price_cents, sort_order) values
  ('free',  'Free',  30,   40,  0,    0),
  ('pro',   'Pro',   300,  400, 2900, 1),
  ('turbo', 'Turbo', 1500, 2000, 4900, 2)
on conflict (id) do nothing;

-- ------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  phone text,                 -- national number, digits only
  phone_country_code text,    -- e.g. "971"
  city text,
  country text,               -- ISO 3166-1 alpha-2, e.g. "AE"
  nationality text,
  headline text,
  current_title text,
  current_company text,
  years_experience integer check (years_experience between 0 and 60),
  skills text[] not null default '{}',
  summary text,
  linkedin_url text,
  github_url text,
  portfolio_url text,
  experience jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  cv_path text,
  cv_file_name text,
  answers jsonb not null default '{}'::jsonb,      -- questionnaire answers (see extension/shared/questions.js)
  preferences jsonb not null default '{}'::jsonb,  -- target roles, locations, salary, work modes
  settings jsonb not null default '{"mode":"review","dailyLimit":25,"unknownQuestion":"pause"}'::jsonb,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------- subscriptions
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text not null default 'free' references public.plans (id),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  period_start timestamptz not null default date_trunc('month', now()),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------- applications
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  company text,
  job_title text,
  job_url text,
  external_job_id text,
  location text,
  status text not null default 'submitted'
    check (status in ('submitted', 'interviewing', 'offer', 'rejected', 'withdrawn')),
  fields_filled integer not null default 0,
  ai_answers_used integer not null default 0,
  notes text,
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists applications_unique_job
  on public.applications (user_id, platform, external_job_id) where external_job_id is not null;
create index if not exists applications_user_applied_at on public.applications (user_id, applied_at desc);

-- ------------------------------------------------ saved screening answers
create table if not exists public.saved_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  question_key text not null,           -- normalized question text
  answer text,                          -- null = asked but not answered yet
  options text[],
  source text not null default 'user' check (source in ('user', 'ai', 'pending')),
  times_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_key)
);

-- ------------------------------------------------------------- AI usage
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  answers integer not null default 0,
  cv_parses integer not null default 0,
  primary key (user_id, day)
);

-- -------------------------------------------------------------- waitlist
create table if not exists public.waitlist (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_id text references public.plans (id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ triggers
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications for each row execute function public.touch_updated_at();
drop trigger if exists saved_answers_touch on public.saved_answers;
create trigger saved_answers_touch before update on public.saved_answers for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'given_name', split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1)),
    new.raw_user_meta_data ->> 'family_name'
  )
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may not change their own plan or onboarding-protected columns via the API.
create or replace function public.guard_subscription_update() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'subscriptions are managed by the server';
  end if;
  return new;
end $$;
drop trigger if exists subscriptions_guard on public.subscriptions;
create trigger subscriptions_guard before update on public.subscriptions
  for each row execute function public.guard_subscription_update();

-- ---------------------------------------------------------------- RLS
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.applications enable row level security;
alter table public.saved_answers enable row level security;
alter table public.ai_usage enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (is_public);

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists applications_select_own on public.applications;
create policy applications_select_own on public.applications for select using (auth.uid() = user_id);
drop policy if exists applications_update_own on public.applications;
create policy applications_update_own on public.applications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Inserts go through public.record_application() so credits are enforced.
-- Users may only change status/notes (not dates), and can't delete rows - otherwise usage could be reset.
revoke insert, update, delete on public.applications from anon, authenticated;
grant update (status, notes) on public.applications to authenticated;
revoke insert, update, delete on public.plans, public.subscriptions, public.ai_usage from anon, authenticated;

drop policy if exists saved_answers_own on public.saved_answers;
create policy saved_answers_own on public.saved_answers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_usage_read_own on public.ai_usage;
create policy ai_usage_read_own on public.ai_usage for select using (auth.uid() = user_id);

drop policy if exists waitlist_own on public.waitlist;
create policy waitlist_own on public.waitlist for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------ usage & credits
create or replace function public.get_usage() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  sub record;
  used integer;
  ai_today integer;
  period_start timestamptz;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select s.plan_id, s.status, p.name, p.monthly_applications, p.daily_ai_answers
    into sub
    from subscriptions s join plans p on p.id = s.plan_id
   where s.user_id = uid;

  if not found then
    insert into subscriptions (user_id) values (uid) on conflict do nothing;
    select s.plan_id, s.status, p.name, p.monthly_applications, p.daily_ai_answers
      into sub from subscriptions s join plans p on p.id = s.plan_id where s.user_id = uid;
  end if;

  period_start := date_trunc('month', now());
  select count(*) into used from applications
   where user_id = uid and applied_at >= period_start;
  select coalesce(answers, 0) into ai_today from ai_usage where user_id = uid and day = current_date;

  return jsonb_build_object(
    'plan', sub.plan_id,
    'planName', sub.name,
    'status', sub.status,
    'monthlyLimit', sub.monthly_applications,
    'used', used,
    'remaining', greatest(sub.monthly_applications - used, 0),
    'periodStart', period_start,
    'periodEnd', period_start + interval '1 month',
    'aiDailyLimit', sub.daily_ai_answers,
    'aiUsedToday', coalesce(ai_today, 0)
  );
end $$;

create or replace function public.record_application(
  p_platform text,
  p_company text,
  p_job_title text,
  p_job_url text,
  p_external_job_id text default null,
  p_location text default null,
  p_fields_filled integer default 0,
  p_ai_answers_used integer default 0
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  usage jsonb;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- serialize per user so two tabs can't overspend
  perform pg_advisory_xact_lock(hashtext(uid::text));

  if p_external_job_id is not null then
    select id into new_id from applications
     where user_id = uid and platform = p_platform and external_job_id = p_external_job_id;
    if found then
      return jsonb_build_object('id', new_id, 'duplicate', true, 'usage', public.get_usage());
    end if;
  end if;

  usage := public.get_usage();
  if (usage ->> 'remaining')::int <= 0 then
    raise exception 'credit_limit_reached' using errcode = 'P0001';
  end if;

  insert into applications (user_id, platform, company, job_title, job_url, external_job_id, location, fields_filled, ai_answers_used)
  values (uid, p_platform, left(p_company, 200), left(p_job_title, 300), left(p_job_url, 2000), p_external_job_id,
          left(p_location, 200), greatest(p_fields_filled, 0), greatest(p_ai_answers_used, 0))
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'duplicate', false, 'usage', public.get_usage());
end $$;

-- Called by the answer-question edge function (service role) to meter AI usage.
create or replace function public.consume_ai_answer(p_user_id uuid, p_kind text default 'answer') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  lim integer;
  current_count integer;
begin
  select p.daily_ai_answers into lim
    from subscriptions s join plans p on p.id = s.plan_id where s.user_id = p_user_id;
  lim := coalesce(lim, 40);

  insert into ai_usage (user_id, day) values (p_user_id, current_date) on conflict do nothing;

  if p_kind = 'cv' then
    update ai_usage set cv_parses = cv_parses + 1
     where user_id = p_user_id and day = current_date and cv_parses < 10
     returning cv_parses into current_count;
    return jsonb_build_object('allowed', current_count is not null, 'used', current_count, 'limit', 10);
  end if;

  update ai_usage set answers = answers + 1
   where user_id = p_user_id and day = current_date and answers < lim
   returning answers into current_count;
  return jsonb_build_object('allowed', current_count is not null, 'used', current_count, 'limit', lim);
end $$;

revoke all on function public.consume_ai_answer(uuid, text) from public, anon, authenticated;
grant execute on function public.get_usage() to authenticated;
grant execute on function public.record_application(text, text, text, text, text, text, integer, integer) to authenticated;

-- ------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 10485760,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'])
on conflict (id) do nothing;

drop policy if exists cvs_own_read on storage.objects;
create policy cvs_own_read on storage.objects for select
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cvs_own_insert on storage.objects;
create policy cvs_own_insert on storage.objects for insert
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cvs_own_update on storage.objects;
create policy cvs_own_update on storage.objects for update
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists cvs_own_delete on storage.objects;
create policy cvs_own_delete on storage.objects for delete
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);
