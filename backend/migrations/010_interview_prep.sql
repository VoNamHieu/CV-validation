-- Interview prep. Once a tailored CV reaches the interview stage, the app
-- lazily generates a personalized "dossier" (likely questions, talking points,
-- claims to be ready to defend, JD gaps). The dossier is cached by the triple
-- (user, application, cv_hash): re-opening the same prep is a cache hit, and a
-- new tailored CV (different hash) generates a fresh one.
--
-- `job_ref` is a soft reference to public.applications.id (text, no FK) so the
-- prep survives even if the application row is later reworked; user-scoping is
-- enforced by the backend (service-role bypasses RLS), like every other table.
-- Additive + idempotent.

create table if not exists public.interview_preps (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    job_ref     text not null,                       -- application id
    cv_hash     text not null,                       -- sha1(stable-stringify(tailored_cv))
    dossier     jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, job_ref, cv_hash)               -- lazy-generate, cache hit by the triple
);

create table if not exists public.practice_attempts (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    prep_id         uuid not null references public.interview_preps(id) on delete cascade,
    question_id     text not null,
    attempt_no      int not null,
    answer_text     text,
    self_reflection text,
    checklist       jsonb not null default '{}'::jsonb,  -- eval result → readiness/compare
    created_at      timestamptz not null default now()
);

create index if not exists interview_preps_user_idx on public.interview_preps (user_id, created_at desc);
create index if not exists practice_attempts_prep_idx on public.practice_attempts (prep_id, attempt_no);

alter table public.interview_preps enable row level security;
alter table public.practice_attempts enable row level security;

-- Select-own policies for a future supabase-js read path (backend bypasses RLS).
do $$ begin
    create policy interview_preps_own on public.interview_preps
        for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
    create policy practice_attempts_own on public.practice_attempts
        for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
