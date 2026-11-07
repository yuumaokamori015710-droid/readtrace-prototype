-- Internal catalog cache/budgets only; no user shelf or auth data is stored here.
create schema if not exists readtrace_catalog_private;
revoke all on schema readtrace_catalog_private from public, anon, authenticated;
create table readtrace_catalog_private.cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('google','openlibrary','ndl','itunes','wikidata')),
  payload jsonb check (octet_length(payload::text) <= 140000),
  expires_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  touched_at timestamptz not null default now()
);
create index readtrace_catalog_cache_expiry on readtrace_catalog_private.cache(expires_at);
create table readtrace_catalog_private.budgets (
  bucket text primary key,
  used integer not null default 0,
  expires_at timestamptz not null
);
create index readtrace_catalog_budget_expiry on readtrace_catalog_private.budgets(expires_at);
alter table readtrace_catalog_private.cache enable row level security;
alter table readtrace_catalog_private.budgets enable row level security;
revoke all on all tables in schema readtrace_catalog_private from public, anon, authenticated;

create function readtrace_catalog_private.take(p_bucket text, p_limit integer, p_seconds integer)
returns boolean language plpgsql set search_path = '' as $$
declare n integer;
begin
  insert into readtrace_catalog_private.budgets(bucket, used, expires_at)
  values (p_bucket, 1, now() + make_interval(secs => p_seconds))
  on conflict (bucket) do update
    set used = case when budgets.expires_at <= now() then 1 else budgets.used + 1 end,
        expires_at = case when budgets.expires_at <= now() then excluded.expires_at else budgets.expires_at end
    where budgets.expires_at <= now() or budgets.used < p_limit
  returning used into n;
  return n is not null;
end $$;
revoke all on function readtrace_catalog_private.take(text,integer,integer) from public, anon, authenticated;

create function public.readtrace_catalog_preflight(p_ip text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_ip !~ '^[0-9a-f]{64}$' then raise exception 'Invalid network'; end if;
  if not readtrace_catalog_private.take('preflight:minute:'||p_ip,60,60) then
    return jsonb_build_object('allowed',false,'retryAfter',60,'kind','minute');
  end if;
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.readtrace_catalog_preflight(text) from public, anon, authenticated;
grant execute on function public.readtrace_catalog_preflight(text) to service_role;

create or replace function public.readtrace_catalog_gate(p_actor text, p_ip text, p_authenticated boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare day_limit integer := case when p_authenticated then 200 else 60 end; retry integer; kind text;
begin
  if p_actor !~ '^[0-9a-f]{64}$' or p_ip !~ '^[0-9a-f]{64}$' then raise exception 'Invalid actor'; end if;
  delete from readtrace_catalog_private.budgets where expires_at < now() - interval '1 day';
  -- Reject individual abuse before it can consume the global search allowance.
  if not readtrace_catalog_private.take('actor:minute:' || p_actor,30,60) then kind:='minute';
  elsif not readtrace_catalog_private.take('ip:minute:' || p_ip,60,60) then kind:='minute';
  elsif not readtrace_catalog_private.take('actor:day:' || p_actor,day_limit,86400) then kind:='day';
  elsif not readtrace_catalog_private.take('ip:day:' || p_ip,500,86400) then kind:='day';
  elsif not readtrace_catalog_private.take('all:minute',240,60) then kind:='minute';
  elsif not readtrace_catalog_private.take('all:day',5000,86400) then kind:='day';
  end if;
  if kind='minute' then
    select greatest(1,ceil(extract(epoch from max(expires_at)-now()))::integer) into retry from readtrace_catalog_private.budgets
      where bucket in ('all:minute','ip:minute:' || p_ip,'actor:minute:' || p_actor);
    return jsonb_build_object('allowed', false, 'retryAfter', retry, 'kind', 'minute');
  end if;
  if kind='day' then
    select greatest(1,ceil(extract(epoch from max(expires_at)-now()))::integer) into retry from readtrace_catalog_private.budgets
      where bucket in ('all:day','ip:day:' || p_ip,'actor:day:' || p_actor);
    return jsonb_build_object('allowed', false, 'retryAfter', retry, 'kind', 'day');
  end if;
  return jsonb_build_object('allowed', true);
end $$;

create function public.readtrace_catalog_claim(p_key text, p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r readtrace_catalog_private.cache%rowtype; token uuid := gen_random_uuid(); day_bucket text;
begin
  if p_key !~ '^[0-9a-f]{64}$' or p_provider not in ('google','openlibrary','ndl','itunes','wikidata') then raise exception 'Invalid cache key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select * into r from readtrace_catalog_private.cache where key = p_key;
  if r.payload is not null and r.expires_at > now() then
    return jsonb_build_object('state','hit','payload',r.payload,'ttl',greatest(0,floor(extract(epoch from r.expires_at - now()))));
  end if;
  if r.lease_until > now() then return jsonb_build_object('state','pending'); end if;
  if p_provider = 'google' then
    if exists (select 1 from readtrace_catalog_private.budgets where bucket = 'google:block' and expires_at > now()) then
      return jsonb_build_object('state','blocked');
    end if;
    day_bucket := 'google:day:' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD');
    if not readtrace_catalog_private.take('google:minute', 40, 60)
       or not readtrace_catalog_private.take(day_bucket, 900, 172800) then
      return jsonb_build_object('state','budget');
    end if;
  elsif not readtrace_catalog_private.take(p_provider || ':minute', case when p_provider = 'itunes' then 18 else 60 end, 60)
     or not readtrace_catalog_private.take(p_provider || ':day', 3000, 86400) then
    return jsonb_build_object('state','budget');
  end if;
  insert into readtrace_catalog_private.cache(key,provider,lease_token,lease_until)
  values(p_key,p_provider,token,now()+interval '20 seconds')
  on conflict(key) do update set payload=null, provider=excluded.provider, lease_token=token, lease_until=excluded.lease_until, touched_at=now();
  return jsonb_build_object('state','miss','token',token);
end $$;

create function public.readtrace_catalog_finish(p_key text, p_token uuid, p_payload jsonb, p_ttl integer, p_block text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare provider_name text;
begin
  if p_ttl < 0 or p_ttl > 86400 or octet_length(p_payload::text) > 140000 then raise exception 'Invalid cache lifetime or size'; end if;
  select provider into provider_name from readtrace_catalog_private.cache where key=p_key and lease_token=p_token for update;
  if not found then return false; end if;
  if provider_name = 'google' and p_block in ('day','minute') then
    insert into readtrace_catalog_private.budgets(bucket,used,expires_at)
    values('google:block',0,case when p_block='day'
      then (date_trunc('day',now() at time zone 'America/Los_Angeles')+interval '1 day') at time zone 'America/Los_Angeles'
      else now()+interval '1 minute' end)
    on conflict(bucket) do update set expires_at=greatest(budgets.expires_at,excluded.expires_at);
  end if;
  if p_payload is not null and p_ttl > 0 then
    update readtrace_catalog_private.cache set payload=p_payload,expires_at=now()+make_interval(secs=>p_ttl),lease_token=null,lease_until=null,touched_at=now() where key=p_key;
  else
    delete from readtrace_catalog_private.cache where key=p_key;
  end if;
  delete from readtrace_catalog_private.cache where expires_at <= now() and coalesce(lease_until,now()) <= now();
  delete from readtrace_catalog_private.cache where key in (
    select key from readtrace_catalog_private.cache where lease_token is null order by touched_at desc offset 250
  );
  return true;
end $$;

revoke all on function public.readtrace_catalog_gate(text,text,boolean) from public, anon, authenticated;
revoke all on function public.readtrace_catalog_claim(text,text) from public, anon, authenticated;
revoke all on function public.readtrace_catalog_finish(text,uuid,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.readtrace_catalog_gate(text,text,boolean) to service_role;
grant execute on function public.readtrace_catalog_claim(text,text) to service_role;
grant execute on function public.readtrace_catalog_finish(text,uuid,jsonb,integer,text) to service_role;
