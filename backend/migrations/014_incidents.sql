-- System incident log. Tracks errors across all layers — backend system
-- errors, DB errors, frontend API-call failures, and extension connection
-- failures — so operators can see "what broke, where, how often" in one place.
-- Separate from public.events (product analytics funnel). Append-only; written
-- by the backend (service role) so RLS is enabled with no policies — clients
-- never read/write this directly, only via POST /incidents (ingest) and
-- /admin/incidents/* (read + resolve).

create table if not exists public.incidents (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid references auth.users(id) on delete set null,
    session_id      text,
    -- 'system_error' | 'extension_error' | 'api_error' | 'db_error'
    incident_type   text not null,
    -- 'backend' | 'frontend' | 'extension'
    source          text not null,
    -- e.g. 'upload_cv', 'extension_sync', 'db.req', an endpoint path
    module          text,
    -- 'error' | 'warning'
    severity        text not null default 'error',
    message         text,
    code            text,
    stack           text,
    context         jsonb,
    resolved        boolean not null default false,
    resolved_at     timestamptz,
    resolved_by     text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_incidents_type_created
    on public.incidents (incident_type, created_at desc);
create index if not exists idx_incidents_created
    on public.incidents (created_at desc);
-- Fast lookup of the unresolved queue (the admin panel's default view).
create index if not exists idx_incidents_unresolved
    on public.incidents (created_at desc) where not resolved;

alter table public.incidents enable row level security;
