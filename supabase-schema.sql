create table if not exists public.readtrace_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  author text,
  genre text,
  source text,
  description text,
  status text not null default 'want' check (status in ('want', 'reading', 'done')),
  rating text not null default '未評価',
  cover text,
  isbn13 text,
  isbn10 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.readtrace_books enable row level security;

create policy "Users can read own readtrace books"
on public.readtrace_books
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own readtrace books"
on public.readtrace_books
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own readtrace books"
on public.readtrace_books
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own readtrace books"
on public.readtrace_books
for delete
to authenticated
using (auth.uid() = user_id);
