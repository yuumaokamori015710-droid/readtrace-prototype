-- Additive record fields. NULL impression identifies legacy completions.
-- The existing rating remains the legacy score, never a computed average.
alter table public.readtrace_records
  add column impression text,
  add column axis_ratings jsonb not null default '{}'::jsonb,
  drop constraint readtrace_records_check,
  add constraint readtrace_records_impression_check check (
    impression is null or (
      octet_length(impression) <= 8192 and impression ~ '[^[:space:]]'
      and position(chr(10) in impression) = 0 and position(chr(13) in impression) = 0
      and position(chr(8232) in impression) = 0 and position(chr(8233) in impression) = 0
    )
  ),
  add constraint readtrace_records_completion_check check (
    status <> 'done' or impression is not null or rating is not null
  ),
  add constraint readtrace_records_axes_check check (
    jsonb_typeof(axis_ratings) = 'object'
    and axis_ratings - array['immersion', 'originality', 'structure', 'expression', 'afterglow'] = '{}'::jsonb
    and (not axis_ratings ? 'immersion' or axis_ratings->'immersion' in ('0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'))
    and (not axis_ratings ? 'originality' or axis_ratings->'originality' in ('0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'))
    and (not axis_ratings ? 'structure' or axis_ratings->'structure' in ('0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'))
    and (not axis_ratings ? 'expression' or axis_ratings->'expression' in ('0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'))
    and (not axis_ratings ? 'afterglow' or axis_ratings->'afterglow' in ('0.5','1','1.5','2','2.5','3','3.5','4','4.5','5'))
  );

-- Keep the existing trigger and policies, extending only the history payload.
create or replace function public.readtrace_record_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.history = coalesce(new.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'status', new.status, 'rating', new.rating, 'axisRatings', new.axis_ratings,
      'startedAt', new.started_at, 'completedAt', new.completed_at, 'at', now()));
  elsif old.status is distinct from new.status or old.rating is distinct from new.rating
    or old.axis_ratings is distinct from new.axis_ratings
    or old.started_at is distinct from new.started_at or old.completed_at is distinct from new.completed_at then
    new.history = old.history || jsonb_build_array(jsonb_build_object(
      'status', new.status, 'rating', new.rating, 'axisRatings', new.axis_ratings,
      'startedAt', new.started_at, 'completedAt', new.completed_at, 'at', now()));
  else
    new.history = old.history;
  end if;
  return new;
end;
$$;
