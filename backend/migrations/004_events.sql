-- Funnel / product analytics events. Append-only; written by the backend
-- (service role) so RLS is enabled with no policies — clients never read/write
-- this table directly, only via /events (ingest) and /admin/analytics/* (read).

create table if not exists public.events (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references auth.users(id) on delete set null,
    session_id  text not null,
    event       text not null,
    page_url    text,
    meta        jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists idx_events_event_session on public.events (event, session_id);
create index if not exists idx_events_created on public.events (created_at desc);

alter table public.events enable row level security;
