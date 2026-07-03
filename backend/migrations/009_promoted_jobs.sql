-- Promoted job landing pages ("trang truyền thông"). An admin picks a job from
-- the store and publishes a public, self-hosted page for it. The page renders a
-- SNAPSHOT of the job (title/company/location/JD) frozen at publish time — so
-- the marketing link stays alive even after the source posting is crawled dead
-- or the job row changes. Rendering is always on-demand from `snapshot`; we
-- never store rendered HTML (template changes must propagate to old pages).
--
-- `job_id` is a soft reference (no FK) so deleting a job never orphans a live
-- public link. `snapshot` also holds the internal `source_url` used by the
-- apply flow — it is NEVER exposed on the public read endpoint.
-- Additive + idempotent.

create table if not exists public.promoted_jobs (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique,
    job_id      uuid,                       -- soft ref to public.jobs.id (no FK)
    snapshot    jsonb not null default '{}'::jsonb,
    status      text not null default 'published',   -- draft | published | unpublished
    template    text not null default 'default',
    og_image_url text,
    view_count  bigint not null default 0,
    created_by  uuid,                       -- admin user id who published
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- Public lookup is by slug; the only hot read path.
create index if not exists promoted_jobs_slug_idx on public.promoted_jobs (slug);
-- Admin listing: newest first, and re-publish idempotency check by job_id.
create index if not exists promoted_jobs_job_id_idx on public.promoted_jobs (job_id);
