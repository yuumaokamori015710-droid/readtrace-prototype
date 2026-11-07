-- Integration assertions only. All fixtures are rolled back, including auth users.
begin;
insert into auth.users(id, aud, role, created_at, updated_at) values
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated',now(),now()),
 ('22222222-2222-4222-8222-222222222222','authenticated','authenticated',now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
insert into public.readtrace_profiles(id,name) values('11111111-1111-4111-8111-111111111111','RLS check A');
insert into public.readtrace_settings(user_id,monthly_goal) values('11111111-1111-4111-8111-111111111111',8);
insert into public.readtrace_records(id,work,status,rating,review,visibility) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"id":"test-private","type":"book","title":"Private fixture"}','want',null,'private-marker','private'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','{"id":"test-public","type":"book","title":"Public fixture"}','done',4.5,'spoiler-marker','public');
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
insert into public.readtrace_profiles(id,name) values('22222222-2222-4222-8222-222222222222','RLS check B');
insert into public.readtrace_records(id,work,status,rating,visibility) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"id":"test-movie","type":"movie","title":"Movie fixture"}','watching',null,'private');
do $$
declare affected integer; denied boolean;
begin
  if (select count(*) from public.readtrace_records where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 0 then raise exception 'Private record leaked'; end if;
  if (select count(*) from public.readtrace_records where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Public record unavailable to authenticated user'; end if;
  if (select count(*) from public.readtrace_settings where user_id='11111111-1111-4111-8111-111111111111') <> 0 then raise exception 'Private settings leaked'; end if;
  update public.readtrace_records set review='forged' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Other user record updated'; end if;
  delete from public.readtrace_records where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Other user record deleted'; end if;
  denied = false;
  begin
    insert into public.readtrace_records(user_id,work,status,visibility) values('11111111-1111-4111-8111-111111111111','{"id":"forged","type":"book","title":"Forged fixture"}','want','private');
  exception when insufficient_privilege then denied = true; end;
  if not denied then raise exception 'Owner ID forgery allowed'; end if;
  denied = false;
  begin
    update public.readtrace_records set user_id='11111111-1111-4111-8111-111111111111' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  exception when insufficient_privilege then denied = true; end;
  if not denied then raise exception 'Owner transfer allowed'; end if;
  denied = false;
  begin
    insert into public.readtrace_records(work,status,visibility) values('{"id":"no-rating","type":"book","title":"Invalid completion"}','done','private');
  exception when check_violation then denied = true; end;
  if not denied then raise exception 'Completion with neither impression nor legacy rating allowed'; end if;
  denied = false;
  begin
    insert into public.readtrace_comments(record_id,text) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Not allowed');
  exception when insufficient_privilege then denied = true; end;
  if not denied then raise exception 'Private comment allowed'; end if;
end;
$$;
insert into public.readtrace_likes(record_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.readtrace_comments(record_id,text) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Allowed comment');
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
update public.readtrace_records set status='reading', started_at='2026-11-01' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if (select count(*) from public.readtrace_records where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 0 then raise exception 'Other user movie leaked'; end if;
  if (select jsonb_array_length(history) from public.readtrace_records where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 2 then raise exception 'History not persisted'; end if;
  if (select count(*) from public.readtrace_comments where record_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 1 then raise exception 'Public comment unavailable'; end if;
end;
$$;
update public.readtrace_records
set status='done', impression='一言のテスト', completed_at='2026-11-07', axis_ratings='{"immersion":0.5,"afterglow":5}', spoiler=true
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.readtrace_records(work,status,impression,visibility)
values('{"id":"test-unrated","type":"movie","title":"Unrated fixture"}','done','余韻','private');
do $$
begin
  if not exists (select 1 from public.readtrace_records
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and rating is null and review='private-marker'
      and impression='一言のテスト' and completed_at='2026-11-07' and spoiler and visibility='private'
      and history->-1->'axisRatings' = '{"immersion":0.5,"afterglow":5}'::jsonb)
  then raise exception 'New fields or history were not preserved'; end if;
  if not exists (select 1 from public.readtrace_records where work->>'id'='test-unrated'
    and status='done' and completed_at is null and rating is null and axis_ratings='{}')
  then raise exception 'Unrated completion or unknown date could not be saved'; end if;
  if not exists (select 1 from public.readtrace_records where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and rating=4.5 and impression is null and axis_ratings='{}')
  then raise exception 'Legacy score was changed'; end if;
  begin
    update public.readtrace_records set axis_ratings='{"immersion":0.6}' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'Fractional axis outside half-point steps accepted';
  exception when check_violation then null;
  end;
  begin
    update public.readtrace_records set impression=E'line\nbreak' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'Multi-line impression accepted';
  exception when check_violation then null;
  end;
end;
$$;
update public.readtrace_records set visibility='private' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$
begin
  if exists (select 1 from public.readtrace_records where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  then raise exception 'Private new record fields leaked'; end if;
  if (select count(*) from public.readtrace_comments where record_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 0 then raise exception 'Comment leaked after privacy change'; end if;
  if (select count(*) from public.readtrace_likes where record_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 0 then raise exception 'Like leaked after privacy change'; end if;
end;
$$;
reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform id from public.readtrace_records; exception when insufficient_privilege then denied = true; end;
  if not denied then raise exception 'Anonymous record access allowed'; end if;
end;
$$;
reset role;
rollback;
select 'passed: 21 DB assertions; all fixtures rolled back' as result;
