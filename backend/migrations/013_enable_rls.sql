-- 013: enable Row-Level Security on the two public tables still exposed to the
-- anon PostgREST API (Supabase advisor: rls_disabled_in_public, 2026-07-06).
--
-- Context: the app never uses supabase-js. The backend connects as the Supabase
-- `postgres` role (BYPASSRLS) via the service DSN and enforces user_id itself, so
-- enabling RLS does NOT affect the backend — it only closes direct anon /
-- authenticated access through the auto-generated REST API. No policies are added
-- on purpose: with RLS on and zero policies, non-superuser roles get deny-all,
-- exactly matching companies/jobs/events/feedback (already RLS-on, 0 policies).
--
-- admin_members is the critical one: without RLS, anyone with the (public) anon
-- key could read the admin roster or INSERT themselves as an admin.
--
-- Reversible: ALTER TABLE ... DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoted_jobs ENABLE ROW LEVEL SECURITY;
