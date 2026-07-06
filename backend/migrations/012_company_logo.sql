-- Company logo store. Until now a company's logo was only ever guessed at
-- runtime from its domain via a third-party CDN (Clearbit) — often missing or
-- wrong. When an admin uploads a real logo while building a promoted page
-- ("trang truyền thông"), we now mirror it onto the linked company so the same
-- brand image is reused everywhere and auto-seeds future promoted pages for
-- that company (no re-upload).
--
-- Stored inline as base64 (same shape as promoted_jobs.snapshot.logo_b64),
-- downscaled ≤256px / ≤~512KB by the uploader. Kept OUT of the default company
-- SELECT (app/db/companies.py _COLS) so listing companies never drags the
-- bytes; the bytes are read only by the dedicated logo-serving endpoint.
-- Additive + idempotent.

alter table public.companies
    add column if not exists logo_b64  text,
    add column if not exists logo_mime text;
