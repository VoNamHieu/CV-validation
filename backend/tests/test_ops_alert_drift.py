"""Drift-alert engine: ops_alert dedupe + the pure detector predicates."""
import pytest

from app.services import ops_alert
from app.services.job_ingest import _identity_turnover
from app.tasks.cron_refresh import _mostly_broken


@pytest.fixture
def wired(monkeypatch):
    """In-memory cache + captured telegram/incident sinks."""
    store: dict = {}
    sent: list[str] = []
    incidents: list[dict] = []

    async def get_json(key):
        return store.get(key)

    async def set_json(key, value, ttl_seconds):
        store[key] = value

    async def report(incident_type, **kw):
        incidents.append({"type": incident_type, **kw})

    monkeypatch.setattr(ops_alert.cache, "get_json", get_json)
    monkeypatch.setattr(ops_alert.cache, "set_json", set_json)
    monkeypatch.setattr(ops_alert.telegram, "notify", sent.append)
    monkeypatch.setattr(ops_alert.incidents_svc, "report", report)
    return store, sent, incidents


async def test_alert_fires_then_dedupes(wired):
    store, sent, incidents = wired
    assert await ops_alert.alert("links_broken", "GHN", "5/5 hỏng") is True
    assert len(sent) == 1 and "GHN" in sent[0]
    assert incidents and incidents[0]["module"] == "drift.links_broken"
    # same fingerprint inside the TTL window → suppressed
    assert await ops_alert.alert("links_broken", "GHN", "5/5 hỏng") is False
    assert len(sent) == 1


async def test_alert_distinct_fingerprints_both_fire(wired):
    _, sent, _ = wired
    await ops_alert.alert("career_url_moved", "Ahamove", "a → b",
                          fingerprint="career_url_moved:Ahamove:careers.ahamove.com")
    await ops_alert.alert("career_url_moved", "Ahamove", "a → c",
                          fingerprint="career_url_moved:Ahamove:elsewhere.com")
    assert len(sent) == 2


async def test_alert_survives_cache_failure(wired, monkeypatch):
    _, sent, _ = wired

    async def boom(*a, **k):
        raise RuntimeError("redis down")

    monkeypatch.setattr(ops_alert.cache, "get_json", boom)
    assert await ops_alert.alert("feed_died", "TGDD", "feed rỗng") is True
    assert len(sent) == 1


def test_identity_turnover_fires_on_wholesale_swap():
    prev = {f"https://old/{i}" for i in range(10)}
    live = [f"https://new/{i}" for i in range(8)]
    assert _identity_turnover(prev, live) is True


def test_identity_turnover_quiet_on_any_overlap_or_small_sets():
    prev = {f"https://old/{i}" for i in range(10)}
    assert _identity_turnover(prev, [f"https://old/3"] + [f"https://new/{i}" for i in range(7)]) is False
    assert _identity_turnover({"a", "b"}, ["c", "d", "e", "f", "g"]) is False  # tiny baseline
    assert _identity_turnover(prev, ["x", "y"]) is False  # tiny feed


def test_mostly_broken_thresholds():
    assert _mostly_broken(3, 3) is True     # small sample, unanimous
    assert _mostly_broken(3, 2) is False
    assert _mostly_broken(5, 3) is True     # supermajority
    assert _mostly_broken(10, 5) is False   # under 60%
    assert _mostly_broken(2, 2) is False    # too small to judge
