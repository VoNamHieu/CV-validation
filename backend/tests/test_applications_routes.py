"""End-to-end-ish tests for the /me/applications HTTP surface.

No real DB: the asyncpg-backed repo (app.db.applications) is replaced with an
in-memory fake that mirrors its user-scoping + status/notes semantics, so these
tests exercise the FULL router path (HTTP → auth dependency → repo call) and
prove the two things the job-history-to-backend change relies on:
  1. user-scoping — user A never sees / mutates user B's rows
  2. the new `notes` column + PATCH /notes endpoint are wired

Auth seam: with Supabase unconfigured in tests, get_current_user_id trusts the
`X-User-Id` header, so each request acts as that user.
"""
import uuid

import pytest
from fastapi import Header, HTTPException

from app.db import applications as repo
from app.main import app, RateLimitMiddleware
from app.services.auth import get_current_user_id


def _rate_limiter():
    """Reach the in-process RateLimitMiddleware instance so we can clear its
    per-IP buckets — these tests fire many requests under the shared
    'testclient' IP and would otherwise trip the limiter for later test files."""
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    node = app.middleware_stack
    for _ in range(20):
        if node is None:
            break
        if isinstance(node, RateLimitMiddleware):
            return node
        node = getattr(node, "app", None)
    return None


async def _header_user(x_user_id: str | None = Header(default=None)):
    """Test-only auth: trust X-User-Id directly so each request acts as a user,
    independent of whether Supabase JWT verification is configured in the env."""
    if not x_user_id:
        raise HTTPException(status_code=401, detail="no user")
    return x_user_id


class FakeApplicationsDB:
    """In-memory stand-in for app.db.applications, user-scoped like the real one."""

    def __init__(self):
        self.rows: dict[str, dict] = {}

    async def create(self, *, user_id, status="tailored", notes=None, **fields):
        if status not in repo.STATUSES:
            raise ValueError(f"invalid status {status!r}")
        row_id = str(uuid.uuid4())
        row = {
            "id": row_id, "user_id": user_id, "status": status, "notes": notes,
            "outcome_at": None, "anonymized_at": None,
            "created_at": "2026-06-30T00:00:00Z", "updated_at": "2026-06-30T00:00:00Z",
            **fields,
        }
        self.rows[row_id] = row
        return row

    async def list_for_user(self, user_id, *, status=None):
        out = [r for r in self.rows.values() if r["user_id"] == user_id]
        if status:
            out = [r for r in out if r["status"] == status]
        return out

    async def get(self, app_id, user_id):
        r = self.rows.get(app_id)
        return r if r and r["user_id"] == user_id else None

    async def update_status(self, app_id, user_id, status):
        if status not in repo.STATUSES:
            raise ValueError(f"invalid status {status!r}")
        r = await self.get(app_id, user_id)
        if r:
            r["status"] = status
        return r

    async def update_notes(self, app_id, user_id, notes):
        r = await self.get(app_id, user_id)
        if r:
            r["notes"] = notes
        return r

    async def delete(self, app_id, user_id):
        r = await self.get(app_id, user_id)
        if not r:
            return False
        del self.rows[app_id]
        return True


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeApplicationsDB()
    for name in ("create", "list_for_user", "get", "update_status", "update_notes", "delete"):
        monkeypatch.setattr(repo, name, getattr(fake, name))
    app.dependency_overrides[get_current_user_id] = _header_user
    limiter = _rate_limiter()
    if limiter:
        limiter.clients.clear()
    yield fake
    app.dependency_overrides.pop(get_current_user_id, None)
    # Don't leak our request volume into the shared rate-limit bucket.
    if limiter:
        limiter.clients.clear()


def _as(user_id):
    return {"X-User-Id": user_id}


class TestApplicationsCrud:
    def test_create_then_list_returns_the_row(self, client, fake_db):
        r = client.post("/me/applications", json={
            "job_title": "Senior Frontend Engineer", "company_name": "One Mount",
            "source_url": "https://onemount.com/jobs/123", "fit_score": 92,
            "status": "tailored", "notes": "applied via referral",
        }, headers=_as("user-A"))
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["notes"] == "applied via referral"
        assert created["fit_score"] == 92

        lst = client.get("/me/applications", headers=_as("user-A"))
        assert lst.status_code == 200
        assert [row["id"] for row in lst.json()] == [created["id"]]

    def test_invalid_status_is_rejected(self, client, fake_db):
        r = client.post("/me/applications", json={
            "job_title": "X", "status": "saved",  # 'saved' is UI-only, not a DB status
        }, headers=_as("user-A"))
        assert r.status_code == 400

    def test_update_notes_endpoint(self, client, fake_db):
        created = client.post("/me/applications", json={"job_title": "X"},
                              headers=_as("user-A")).json()
        r = client.patch(f"/me/applications/{created['id']}/notes",
                         json={"notes": "phone screen Tue"}, headers=_as("user-A"))
        assert r.status_code == 200, r.text
        assert r.json()["notes"] == "phone screen Tue"

    def test_update_status_endpoint(self, client, fake_db):
        created = client.post("/me/applications", json={"job_title": "X"},
                              headers=_as("user-A")).json()
        r = client.patch(f"/me/applications/{created['id']}/status",
                         json={"status": "interview"}, headers=_as("user-A"))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "interview"

    def test_delete(self, client, fake_db):
        created = client.post("/me/applications", json={"job_title": "X"},
                              headers=_as("user-A")).json()
        assert client.delete(f"/me/applications/{created['id']}",
                             headers=_as("user-A")).status_code == 200
        assert client.get("/me/applications", headers=_as("user-A")).json() == []


class TestUserIsolation:
    """The whole point of the migration: one user's history is invisible to another."""

    def test_b_cannot_see_a(self, client, fake_db):
        client.post("/me/applications", json={"job_title": "A's job"}, headers=_as("user-A"))
        assert client.get("/me/applications", headers=_as("user-B")).json() == []

    def test_b_cannot_mutate_or_delete_a(self, client, fake_db):
        a_row = client.post("/me/applications", json={"job_title": "A's job"},
                            headers=_as("user-A")).json()
        # B addressing A's id → 404, never a silent cross-user write
        assert client.patch(f"/me/applications/{a_row['id']}/notes",
                            json={"notes": "hax"}, headers=_as("user-B")).status_code == 404
        assert client.patch(f"/me/applications/{a_row['id']}/status",
                            json={"status": "rejected"}, headers=_as("user-B")).status_code == 404
        assert client.delete(f"/me/applications/{a_row['id']}",
                             headers=_as("user-B")).status_code == 404
        # A's row is untouched
        still = client.get("/me/applications", headers=_as("user-A")).json()
        assert len(still) == 1 and still[0]["notes"] is None
