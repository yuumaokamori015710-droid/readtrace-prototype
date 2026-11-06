-- ReadTrace cloud schema. Applied through the Supabase migration API.
create table public.readtrace_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  bio text not null default '' check (char_length(bio) <= 1000),
  avatar_url text not null default '' check (char_length(avatar_url) <= 2000),
  created_at timestamptz not null default now()
);
create table public.readtrace_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.readtrace_profiles(id) on delete cascade,
  work jsonb not null check (
    jsonb_typeof(work) = 'object' and jsonb_typeof(work->'title') = 'string'
    and coalesce(char_length(work->>'title'), 0) between 1 and 1000
    and coalesce(char_length(work->>'id'), 0) between 1 and 1000
    and coalesce(work->>'type', '') in ('book', 'movie')
    and octet_length(work::text) <= 65000
  ),
  work_key text generated always as (
    (work->>'type') || ':' || coalesce(nullif(work->>'isbn13', ''), nullif(work->>'isbn', ''), work->>'id')
  ) stored,
  status text not null check (status in ('want', 'reading', 'watching', 'done')),
  rating numeric(2,1) check (rating between 0.5 and 5 and mod(rating * 2, 1) = 0),
  review text not null default '' check (char_length(review) <= 10000),
  spoiler boolean not null default false,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  started_at date,
  completed_at date,
  history jsonb not null default '[]' check (jsonb_typeof(history) = 'array' and octet_length(history::text) <= 120000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_key),
  check (status <> 'done' or rating is not null),
  check ((work->>'type' = 'book' and status <> 'watching') or (work->>'type' = 'movie' and status <> 'reading')),
  check (started_at is null or completed_at is null or started_at <= completed_at)
);
create index readtrace_records_owner_date on public.readtrace_records(user_id, created_at desc);
create index readtrace_records_public_date on public.readtrace_records(created_at desc) where visibility = 'public';
create table public.readtrace_settings (
  user_id uuid primary key default auth.uid() references public.readtrace_profiles(id) on delete cascade,
  monthly_goal integer not null default 5 check (monthly_goal between 1 and 99)
);
create table public.readtrace_follows (
  user_id uuid not null default auth.uid() references public.readtrace_profiles(id) on delete cascade,
  target_id uuid not null references public.readtrace_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, target_id),
  check (user_id <> target_id)
);
create index readtrace_follows_target on public.readtrace_follows(target_id);
create table public.readtrace_likes (
  user_id uuid not null default auth.uid() references public.readtrace_profiles(id) on delete cascade,
  record_id uuid not null references public.readtrace_records(id) on delete cascade,
  primary key(user_id, record_id)
);
create index readtrace_likes_record on public.readtrace_likes(record_id);
create table public.readtrace_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.readtrace_profiles(id) on delete cascade,
  record_id uuid not null references public.readtrace_records(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index readtrace_comments_record_date on public.readtrace_comments(record_id, created_at);
create index readtrace_comments_owner on public.readtrace_comments(user_id);

alter table public.readtrace_profiles enable row level security;
alter table public.readtrace_records enable row level security;
alter table public.readtrace_settings enable row level security;
alter table public.readtrace_follows enable row level security;
alter table public.readtrace_likes enable row level security;
alter table public.readtrace_comments enable row level security;
revoke all on public.readtrace_profiles, public.readtrace_records, public.readtrace_settings,
  public.readtrace_follows, public.readtrace_likes, public.readtrace_comments from anon;
grant select, insert, update on public.readtrace_profiles, public.readtrace_settings to authenticated;
grant select, insert, update, delete on public.readtrace_records to authenticated;
grant select, insert, delete on public.readtrace_follows, public.readtrace_likes, public.readtrace_comments to authenticated;
grant all on public.readtrace_profiles, public.readtrace_records, public.readtrace_settings,
  public.readtrace_follows, public.readtrace_likes, public.readtrace_comments to service_role;

create policy readtrace_profiles_read on public.readtrace_profiles for select to authenticated using ((select auth.uid()) is not null);
create policy readtrace_profiles_insert on public.readtrace_profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy readtrace_profiles_update on public.readtrace_profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy readtrace_records_read on public.readtrace_records for select to authenticated
  using ((select auth.uid()) is not null and (user_id = (select auth.uid()) or visibility = 'public'));
create policy readtrace_records_insert on public.readtrace_records for insert to authenticated with check (user_id = (select auth.uid()));
create policy readtrace_records_update on public.readtrace_records for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy readtrace_records_delete on public.readtrace_records for delete to authenticated using (user_id = (select auth.uid()));
create policy readtrace_settings_read on public.readtrace_settings for select to authenticated using (user_id = (select auth.uid()));
create policy readtrace_settings_insert on public.readtrace_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy readtrace_settings_update on public.readtrace_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy readtrace_follows_read on public.readtrace_follows for select to authenticated using ((select auth.uid()) is not null);
create policy readtrace_follows_insert on public.readtrace_follows for insert to authenticated with check (user_id = (select auth.uid()));
create policy readtrace_follows_delete on public.readtrace_follows for delete to authenticated using (user_id = (select auth.uid()));
create policy readtrace_likes_read on public.readtrace_likes for select to authenticated using (
  exists (select 1 from public.readtrace_records r where r.id = record_id and r.visibility = 'public' and r.status = 'done')
);
create policy readtrace_likes_insert on public.readtrace_likes for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.readtrace_records r where r.id = record_id and r.visibility = 'public' and r.status = 'done')
);
create policy readtrace_likes_delete on public.readtrace_likes for delete to authenticated using (user_id = (select auth.uid()));
create policy readtrace_comments_read on public.readtrace_comments for select to authenticated using (
  exists (select 1 from public.readtrace_records r where r.id = record_id and r.visibility = 'public' and r.status = 'done')
);
create policy readtrace_comments_insert on public.readtrace_comments for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.readtrace_records r where r.id = record_id and r.visibility = 'public' and r.status = 'done')
);
create policy readtrace_comments_delete on public.readtrace_comments for delete to authenticated using (user_id = (select auth.uid()));

create function public.readtrace_record_history() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.history = coalesce(new.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', new.status, 'rating', new.rating, 'at', now()));
  elsif old.status is distinct from new.status or old.rating is distinct from new.rating
    or old.started_at is distinct from new.started_at or old.completed_at is distinct from new.completed_at then
    new.history = old.history || jsonb_build_array(jsonb_build_object('status', new.status, 'rating', new.rating, 'startedAt', new.started_at, 'completedAt', new.completed_at, 'at', now()));
  else
    new.history = old.history;
  end if;
  return new;
end;
$$;
create trigger readtrace_record_history before insert or update on public.readtrace_records for each row execute function public.readtrace_record_history();

do $$
declare name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach name in array array['readtrace_profiles','readtrace_records','readtrace_settings','readtrace_follows','readtrace_likes','readtrace_comments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = name) then
        execute format('alter publication supabase_realtime add table public.%I', name);
      end if;
    end loop;
  end if;
end;
$$;
