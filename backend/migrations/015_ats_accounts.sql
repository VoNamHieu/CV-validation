-- ATS Candidate Accounts (Workday first). Some ATS gate their apply flow behind
-- a per-COMPANY candidate account: aia.wd3.myworkdayjobs.com and
-- bosch.wd3.myworkdayjobs.com are separate account namespaces. The auto-apply
-- agent therefore needs to sign in — or sign UP — once per tenant, and remember
-- the outcome so the next batch doesn't re-probe (and doesn't trip lockouts).
--
-- Data model:
--   ats_credentials         one row per (email, password) the user ever used.
--                           APPEND-ONLY: password_encrypted is never updated in
--                           place. Changing the default inserts a NEW row and
--                           retires the old one, so tenants whose account was
--                           created with the old password keep working (they pin
--                           credential_id). lifecycle_state distinguishes:
--                             active  — usable for new tenants + pinned ones
--                             retired — superseded default; pinned tenants only
--                             revoked — compromised; NEVER decrypt or use again,
--                                       pinned tenants fall to credential_required
--   ats_default_credentials pointer to the user's CURRENT default credential per
--                           vendor. Explicit pointer, not "newest row" — that
--                           guess breaks under revoke/backfill.
--   ats_tenant_accounts     one row per (user, vendor, tenant). tenant_key is the
--                           canonical host: a Workday session cookie is host-
--                           scoped, so two career sites on the same host share
--                           ONE account — career_site_key is metadata only, and
--                           must NOT be part of the unique key or a per-tenant
--                           password override would fragment across sites.
--   ats_auth_attempts       audit/telemetry. Normalized outcomes only — never a
--                           password, request body, cookie, or raw ATS response.
--
-- password_encrypted holds AES-256-GCM ciphertext from app/services/ats_crypto.py
-- (nonce || ct || tag); encryption_key_version tracks which ATS_CRED_KEY sealed
-- it so keys can be rotated without a bulk re-encrypt.
--
-- RLS is enabled with NO policies at all (unlike 010): these tables are secrets,
-- the backend reaches them with the service-role DSN (BYPASSRLS), and anon/
-- PostgREST must be denied outright. See 013_enable_rls.sql.
-- Additive + idempotent.

create table if not exists public.ats_credentials (
    id                      uuid primary key default gen_random_uuid(),
    user_id                 uuid not null references auth.users(id) on delete cascade,
    ats_vendor              text not null,                  -- 'workday'
    credential_type         text not null default 'default',-- default | tenant_override
    email                   text not null,
    password_encrypted      bytea not null,
    encryption_key_version  text not null,
    lifecycle_state         text not null default 'active', -- active | retired | revoked
    replaced_by_id          uuid null references public.ats_credentials(id) on delete set null,
    created_at              timestamptz not null default now(),
    retired_at              timestamptz null,
    revoked_at              timestamptz null,
    constraint ats_credentials_type_chk
        check (credential_type in ('default', 'tenant_override')),
    constraint ats_credentials_lifecycle_chk
        check (lifecycle_state in ('active', 'retired', 'revoked'))
);

create table if not exists public.ats_default_credentials (
    user_id        uuid not null references auth.users(id) on delete cascade,
    ats_vendor     text not null,
    credential_id  uuid not null references public.ats_credentials(id) on delete cascade,
    updated_at     timestamptz not null default now(),
    primary key (user_id, ats_vendor)
);

create table if not exists public.ats_tenant_accounts (
    id                         uuid primary key default gen_random_uuid(),
    user_id                    uuid not null references auth.users(id) on delete cascade,
    ats_vendor                 text not null,
    tenant_key                 text not null,   -- canonical host, the account scope
    canonical_host             text not null,
    career_site_key            text null,       -- metadata only — NOT in the unique key
    tenant_slug                text null,
    credential_id              uuid null references public.ats_credentials(id) on delete set null,
    account_state              text not null default 'unknown',
    signup_via                 text null,       -- signup | login
    last_error_code            text null,
    last_error_source          text null,       -- authgwy | cxs | dom
    last_auth_success_at       timestamptz null,
    verification_requested_at  timestamptz null,
    verification_expires_at    timestamptz null,
    next_retry_at              timestamptz null,
    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now(),
    unique (user_id, ats_vendor, tenant_key),
    constraint ats_tenant_accounts_state_chk check (account_state in (
        'unknown', 'ready', 'verification_required', 'credential_required',
        'password_reset_required', 'consent_required', 'challenge_required',
        'temporarily_locked', 'unsupported'
    ))
);

create table if not exists public.ats_auth_attempts (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users(id) on delete cascade,
    tenant_account_id  uuid not null references public.ats_tenant_accounts(id) on delete cascade,
    batch_id           text null,
    idempotency_key    text null,
    operation          text not null,   -- login | signup | verify_retry | submission_reconcile
    outcome            text not null,   -- normalized AtsAuthResult.outcome
    source             text not null,   -- authgwy | cxs | dom
    source_code        text null,       -- allowlisted/sanitized code, never raw response
    consent_accepted   jsonb null,      -- sanitized labels of consents ticked on the user's behalf
    retryable          boolean not null default false,
    started_at         timestamptz not null default now(),
    completed_at       timestamptz null,
    automation_version text null
);

create index if not exists ats_credentials_user_idx
    on public.ats_credentials (user_id, ats_vendor, lifecycle_state);
create index if not exists ats_tenant_accounts_user_idx
    on public.ats_tenant_accounts (user_id, ats_vendor);
create index if not exists ats_auth_attempts_tenant_idx
    on public.ats_auth_attempts (tenant_account_id, started_at desc);
-- One row per idempotency key, so an extension network retry can't double-log.
create unique index if not exists ats_auth_attempts_idem_idx
    on public.ats_auth_attempts (user_id, idempotency_key)
    where idempotency_key is not null;

-- Keep updated_at fresh on tenant state transitions (mirrors trg_applications_touch).
create or replace function public.touch_ats_tenant_accounts()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

do $$ begin
    create trigger trg_ats_tenant_accounts_touch
        before update on public.ats_tenant_accounts
        for each row execute function public.touch_ats_tenant_accounts();
exception when duplicate_object then null; end $$;

-- Secrets: RLS on, zero policies → deny-all for anon/authenticated via PostgREST.
-- Only the service-role backend (BYPASSRLS) can read these.
alter table public.ats_credentials         enable row level security;
alter table public.ats_default_credentials enable row level security;
alter table public.ats_tenant_accounts     enable row level security;
alter table public.ats_auth_attempts       enable row level security;
