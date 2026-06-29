-- Credits / usage metering. Applied 2026-06-29.
-- Free grant on signup = 50 credits (~5 full tailor jobs; lazy-granted on first touch by the app,
-- so no GoTrue trigger edit needed). Backend (service-role) does all writes;
-- RLS select-own is for a future supabase-js read path.

create table if not exists public.credits (
    user_id       uuid primary key references auth.users(id) on delete cascade,
    balance       integer not null default 0,
    granted_total integer not null default 0,
    spent_total   integer not null default 0,
    updated_at    timestamptz not null default now()
);

create table if not exists public.credit_ledger (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    delta         integer not null,        -- +grant / -spend
    reason        text not null,           -- 'signup_grant' | 'spend' | 'topup'
    action        text,                    -- AI action key, for spends
    balance_after integer not null,
    created_at    timestamptz not null default now()
);
create index if not exists idx_credit_ledger_user on public.credit_ledger(user_id, created_at desc);

alter table public.credits enable row level security;
alter table public.credit_ledger enable row level security;

do $$ begin
    create policy credits_own on public.credits
        for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
    create policy credit_ledger_own on public.credit_ledger
        for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
