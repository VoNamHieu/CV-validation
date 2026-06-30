-- User feedback / suggestions. Applied 2026-06-30.
-- Collected from the "support us" screen on the first credit top-up and any
-- general feedback entry point. Backend (service-role) writes/reads; admins
-- read via /admin/feedback. user_id is nullable + ON DELETE SET NULL so a
-- deleted account leaves its feedback intact (anonymised).
create table if not exists public.feedback (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid references auth.users(id) on delete set null,
    email      text,
    message    text not null,
    rating     int,          -- optional 1..5
    source     text,         -- 'topup' | 'general' | …
    page_url   text,         -- where it was submitted from (floating widget)
    created_at timestamptz not null default now()
);
alter table public.feedback add column if not exists page_url text;
create index if not exists idx_feedback_created on public.feedback(created_at desc);

alter table public.feedback enable row level security;  -- backend bypasses; no public policy by design
