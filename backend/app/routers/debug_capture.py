"""
Debug capture API — receives a *rendered* DOM snapshot from the browser
extension so we can build/repair job extractors against the page exactly as a
real user's browser sees it (incl. content that anti-bot sites only serve to a
real browser, and JS-rendered DOM the headless probe renders differently).

This is a build-time developer tool, OFF by default: every route 503s unless
DEBUG_CAPTURE_TOKEN is set, and each request must present that token via the
`X-Debug-Token` header. Snapshots live in Redis with a short TTL.

  POST /debug/capture            store a snapshot (extension → here)
  GET  /debug/capture/latest     read back the newest snapshot for a host
  GET  /debug/capture/list       list recent snapshots (host + url + ts)
"""
from __future__ import annotations

import logging
import os
import time
from urllib.parse import urlparse

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import cache
from app.data.featured_companies import FEATURED_COMPANIES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/debug", tags=["Debug Capture"])

# Featured companies whose jobs are JS-rendered / anti-bot, so the headless
# probe can't read them — these are the ones worth capturing from a real
# browser. The batch-scan button pulls this list and walks it automatically.
# URLs come from FEATURED_COMPANIES so they stay in sync. Trim a name once its
# server-side adapter works.
_CAPTURE_TARGET_NAMES = {
    "Atlassian", "Be", "Citi", "Hellmann", "IHG", "IKEA",
    "Lazada", "Maersk", "McKinsey", "Rikkeisoft", "Salesforce",
    "Standard Chartered", "VinFast",
}

_NS = "debug:cap:v1"
_INDEX_KEY = f"{_NS}:__index__"
_TTL = 7 * 24 * 3600           # snapshots expire after 7 days
_MAX_HTML = 3_000_000          # cap stored HTML at ~3 MB
_MAX_INDEX = 100               # keep the last N captures in the index


class CapturePayload(BaseModel):
    url: str = Field(..., max_length=2000)
    title: str = Field("", max_length=500)
    html: str = ""
    anchors: list = Field(default_factory=list)   # [{href, text}]
    tables: list = Field(default_factory=list)     # [[ "cell", ... ], ...]
    nextData: str = ""                              # raw __NEXT_DATA__ JSON
    jsonld: list = Field(default_factory=list)      # raw ld+json blocks
    apis: list = Field(default_factory=list)        # [{method,url,body}] (phase 2)
    note: str = Field("", max_length=1000)


def _require_token(token: str | None) -> None:
    expected = os.getenv("DEBUG_CAPTURE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="debug capture disabled (no DEBUG_CAPTURE_TOKEN)")
    if not token or token != expected:
        raise HTTPException(status_code=401, detail="bad or missing X-Debug-Token")


def _host(url: str) -> str:
    return (urlparse(url).netloc or "unknown").lower().removeprefix("www.")


@router.post("/capture")
async def capture(payload: CapturePayload, x_debug_token: str | None = Header(default=None)):
    _require_token(x_debug_token)
    host = _host(payload.url)
    data = payload.model_dump()
    if data.get("html") and len(data["html"]) > _MAX_HTML:
        data["html"] = data["html"][:_MAX_HTML]
        data["_html_truncated"] = True
    ts = int(time.time())
    data["_ts"] = ts
    data["_host"] = host

    await cache.set_json(f"{_NS}:{host}", data, _TTL)

    # Maintain a small recency index (read-modify-write; low volume).
    index = await cache.get_json(_INDEX_KEY) or []
    index = [e for e in index if e.get("host") != host]   # de-dup by host
    index.insert(0, {"host": host, "url": payload.url, "title": payload.title,
                     "ts": ts, "bytes": len(data.get("html", "")),
                     "anchors": len(payload.anchors), "tables": len(payload.tables)})
    await cache.set_json(_INDEX_KEY, index[:_MAX_INDEX], _TTL)

    logger.info(f"[debug-capture] stored {host} "
                f"({len(data.get('html',''))}B html, {len(payload.anchors)} anchors)")
    return {"ok": True, "host": host, "bytes": len(data.get("html", "")),
            "anchors": len(payload.anchors), "tables": len(payload.tables)}


@router.get("/capture/latest")
async def latest(host: str = Query(...), x_debug_token: str | None = Header(default=None)):
    _require_token(x_debug_token)
    h = host.lower().removeprefix("www.")
    data = await cache.get_json(f"{_NS}:{h}")
    if not data:
        raise HTTPException(status_code=404, detail=f"no capture for host {h}")
    return data


@router.get("/capture/list")
async def list_captures(x_debug_token: str | None = Header(default=None)):
    _require_token(x_debug_token)
    return {"captures": await cache.get_json(_INDEX_KEY) or []}


@router.get("/capture/targets")
async def targets(x_debug_token: str | None = Header(default=None)):
    """URLs the batch-scan button should auto-open + capture (hard JS/anti-bot
    featured sites). The extension walks these one tab at a time."""
    _require_token(x_debug_token)
    return {"targets": [{"name": c.name, "url": c.career_url}
                        for c in FEATURED_COMPANIES if c.name in _CAPTURE_TARGET_NAMES]}
