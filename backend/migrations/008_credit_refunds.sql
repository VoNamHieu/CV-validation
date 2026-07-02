-- Credit idempotency + refunds. Applied 2026-07-02.
--
-- request_id lets a spend be replayed safely (client/proxy retry after a
-- timeout must not double-debit) and lets a refund be correlated to exactly
-- the spend it reverses. The partial unique index is the invariant that makes
-- both idempotent even under concurrent requests: at most ONE 'spend' row and
-- at most ONE 'refund' row can ever exist per (user, request_id).
-- reason now also includes 'refund' (delta > 0, action = the refunded action).

alter table public.credit_ledger
    add column if not exists request_id text;

create unique index if not exists credit_ledger_request_uniq
    on public.credit_ledger (user_id, reason, request_id)
    where request_id is not null;
