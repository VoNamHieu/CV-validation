-- Consent evidence on public.profiles. Applied 2026-06-30.
-- Two-layer consent:
--   terms_accepted_at / terms_version — the mandatory signup checkbox
--     ("Tôi đồng ý với Điều khoản Sử dụng và Chính sách Quyền riêng tư").
--   agent_consent_at — the separate, just-in-time confirmation shown the first
--     time a user enables the auto-apply agent (ToS §5, highest legal risk).
-- Backend (service-role) writes these from /me/accept-terms and /me/agent-consent.

alter table public.profiles
    add column if not exists terms_accepted_at timestamptz,
    add column if not exists terms_version     text,
    add column if not exists agent_consent_at  timestamptz;
