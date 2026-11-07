begin;
do $$
declare a jsonb; b jsonb; i integer; token uuid; passed integer := 0; global_before integer;
begin
  assert not has_schema_privilege('anon','readtrace_catalog_private','usage'); passed:=passed+1;
  assert not has_function_privilege('anon','public.readtrace_catalog_claim(text,text)','execute'); passed:=passed+1;
  assert not has_function_privilege('authenticated','public.readtrace_catalog_gate(text,text,boolean)','execute'); passed:=passed+1;
  assert has_function_privilege('service_role','public.readtrace_catalog_claim(text,text)','execute'); passed:=passed+1;
  for i in 1..60 loop
    if i=31 then update readtrace_catalog_private.budgets set expires_at=now()-interval '1 second' where bucket like '%:minute%'; end if;
    a:=public.readtrace_catalog_gate(repeat('a',64),repeat('b',64),false);
    assert (a->>'allowed')::boolean;
    if i=30 then
      select used into global_before from readtrace_catalog_private.budgets where bucket='all:minute';
      a:=public.readtrace_catalog_gate(repeat('a',64),repeat('b',64),false);
      assert not (a->>'allowed')::boolean and a->>'kind'='minute'; passed:=passed+1;
      assert (select used from readtrace_catalog_private.budgets where bucket='all:minute')=global_before; passed:=passed+1;
    end if;
  end loop;
  update readtrace_catalog_private.budgets set expires_at=now()-interval '1 second' where bucket like '%:minute%';
  a:=public.readtrace_catalog_gate(repeat('a',64),repeat('b',64),false);
  assert not (a->>'allowed')::boolean and a->>'kind'='day'; passed:=passed+1;
  for i in 1..60 loop assert (public.readtrace_catalog_preflight(repeat('9',64))->>'allowed')::boolean; end loop;
  assert not (public.readtrace_catalog_preflight(repeat('9',64))->>'allowed')::boolean; passed:=passed+1;
  a:=public.readtrace_catalog_claim(repeat('c',64),'openlibrary'); token:=(a->>'token')::uuid;
  assert a->>'state'='miss'; passed:=passed+1;
  assert public.readtrace_catalog_claim(repeat('c',64),'openlibrary')->>'state'='pending'; passed:=passed+1;
  assert not public.readtrace_catalog_finish(repeat('c',64),gen_random_uuid(),'{}',120,''); passed:=passed+1;
  assert public.readtrace_catalog_finish(repeat('c',64),token,'{"body":"test","status":200,"headers":{}}',120,'');
  a:=public.readtrace_catalog_claim(repeat('c',64),'openlibrary');
  assert a->>'state'='hit' and a->'payload'->>'body'='test'; passed:=passed+1;
  update readtrace_catalog_private.cache set expires_at=now()-interval '1 second' where key=repeat('c',64);
  assert public.readtrace_catalog_claim(repeat('c',64),'openlibrary')->>'state'='miss'; passed:=passed+1;
  insert into readtrace_catalog_private.budgets(bucket,used,expires_at)
  values('google:day:'||to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD'),899,now()+interval '2 days')
  on conflict(bucket) do update set used=899;
  a:=public.readtrace_catalog_claim(repeat('d',64),'google');
  assert a->>'state'='miss'; passed:=passed+1;
  assert public.readtrace_catalog_claim(repeat('e',64),'google')->>'state'='budget'; passed:=passed+1;
  assert public.readtrace_catalog_finish(repeat('d',64),(a->>'token')::uuid,null,0,'day');
  assert public.readtrace_catalog_claim(repeat('f',64),'google')->>'state'='blocked'; passed:=passed+1;
  raise notice 'Catalog assertions passed: %',passed;
end $$;
select 16 as assertions_passed, (select count(*) from public.readtrace_records) as unchanged_shelf_count;
rollback;
