-- Admin members granted via the admin UI. Two-tier model:
--   * SUPER admins — configured in the ADMIN_EMAILS env var (backend). Highest
--     privilege; the only ones who can remove members. Never stored here.
--   * MEMBER admins — rows in this table, added through the admin console.
--     Full admin rights EXCEPT removing members.
--
-- Keyed by lowercased email (not a user_id FK): a person can be granted admin
-- before they've ever signed up, and require_admin already resolves the caller
-- to an email from their profiles row. Additive + idempotent.

create table if not exists public.admin_members (
    email       text primary key,                    -- lowercased
    added_by    text,                                -- email of the granting admin
    created_at  timestamptz not null default now()
);
