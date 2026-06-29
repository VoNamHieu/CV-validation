"""Direct Supabase Postgres data layer (asyncpg + pgvector).

Import the repositories as namespaces so call-sites read as
``companies.upsert(...)``, ``jobs.search_semantic(...)``, etc.:

    from app.db import jobs, companies, cv_profiles

Connection lifecycle lives in ``app.db.pool`` (get_pool / close_pool), wired
into the FastAPI lifespan in ``app.main``.
"""
from app.db import (  # noqa: F401
    applications,
    companies,
    cv_profiles,
    jobs,
    profiles,
    saved_jobs,
)
from app.db.pool import close_pool, get_pool, ping  # noqa: F401

__all__ = [
    "applications",
    "companies",
    "cv_profiles",
    "jobs",
    "profiles",
    "saved_jobs",
    "get_pool",
    "close_pool",
    "ping",
]
