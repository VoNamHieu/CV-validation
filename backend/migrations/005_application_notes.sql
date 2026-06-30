-- Free-text user notes on an application (the "ghi chú" field in the history
-- board). Additive + idempotent; existing rows get NULL. No index — notes are
-- only read alongside the row they belong to, never queried/filtered on.

alter table public.applications
    add column if not exists notes text;
