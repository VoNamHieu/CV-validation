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

import asyncio
import logging
import os
import re
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
# Only these still need a real-browser capture (JS/anti-bot, but confirmed to
# have VN openings). The rest of the old live-0 list either resolved with a
# correct URL or has no Vietnam career page.
_CAPTURE_TARGET_NAMES = {
    # Boards only a real browser can read (anti-bot / SF or Cloudflare challenge)
    # → the batch-capture button re-snapshots these on a cadence. Maersk is NOT
    # here: it's a plain Workday tenant the `workday` adapter reads server-side.
    "McKinsey", "Rikkeisoft", "Standard Chartered",
    "L'Oréal Vietnam", "Heineken Vietnam",
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
    apis: list = Field(default_factory=list)        # [{method,url,status,type,reqBody,respSnippet}] page's own XHR/fetch — reveals backend job APIs + response shape
    state: str = Field("", max_length=600000)       # embedded JS state (__NUXT__/__INITIAL_STATE__/__APOLLO_STATE__)
    extras: dict = Field(default_factory=dict)      # advanced research metadata (framework, iframes, shadow DOM, metas, forms…)
    note: str = Field("", max_length=1000)


def _require_token(token: str | None) -> None:
    expected = os.getenv("DEBUG_CAPTURE_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="debug capture disabled (no DEBUG_CAPTURE_TOKEN)")
    if not token or token != expected:
        raise HTTPException(status_code=401, detail="bad or missing X-Debug-Token")


def _host(url: str) -> str:
    return (urlparse(url).netloc or "unknown").lower().removeprefix("www.")


def _key(url: str) -> str:
    """Storage key = host + path, so a multi-step flow whose steps live at
    different URLs (each apply step, each job) is kept SEPARATELY instead of the
    latest overwriting the rest. (A pure SPA that never changes its URL across
    steps still collapses to one key — capture those one at a time.)"""
    p = urlparse(url)
    host = (p.netloc or "unknown").lower().removeprefix("www.")
    slug = re.sub(r"[^a-z0-9]+", "-", ((p.path or "/").lower())).strip("-")[:100]
    return f"{host}:{slug}" if slug else host


def _step_hint(html: str) -> str:
    """A multi-step wizard (Workday apply: My Information → My Experience → … →
    Review) keeps ONE url across steps and swaps the content via JS. Derive the
    current step from the DOM (Workday's active-step marker, else a known step
    heading) so each step is stored under its own key instead of overwriting."""
    if not html:
        return ""
    name = ""
    # Workday's active step is <li data-automation-id="progressBarActiveStep"> …
    # <label>current step N of M</label><label>STEP NAME</label></li> — take the
    # label that isn't the "current step N of M" counter.
    m = re.search(r'data-automation-id="progressBarActiveStep".*?</li>', html, re.S)
    if m:
        for lbl in re.findall(r"<label[^>]*>(.*?)</label>", m.group(0), re.S):
            t = re.sub(r"<[^>]+>", "", lbl).strip()
            if t and not re.match(r"(?i)\s*current step\b", t):
                name = t
                break
    if not name:  # fallback: the step heading (h3) / any known step label
        m = re.search(r'>\s*(My Information|My Experience|Application Questions|'
                      r'Voluntary Disclosures|Self Identify|Review|Create Account|Sign In)\s*<', html)
        name = m.group(1) if m else ""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30]


@router.post("/capture")
async def capture(payload: CapturePayload, x_debug_token: str | None = Header(default=None)):
    _require_token(x_debug_token)
    host = _host(payload.url)
    data = payload.model_dump()
    if data.get("html") and len(data["html"]) > _MAX_HTML:
        data["html"] = data["html"][:_MAX_HTML]
        data["_html_truncated"] = True
    # A same-URL wizard (Workday apply) → append the current step so each step is
    # stored SEPARATELY instead of the next overwriting the last.
    step = _step_hint(data.get("html", ""))
    key = _key(payload.url)
    if step:
        key = f"{key}:{step}"
    ts = int(time.time())
    data["_ts"] = ts
    data["_host"] = host
    data["_step"] = step

    await cache.set_json(f"{_NS}:{key}", data, _TTL)

    # Maintain a small recency index (read-modify-write; low volume).
    index = await cache.get_json(_INDEX_KEY) or []
    index = [e for e in index if e.get("key") != key]   # de-dup by host+path(+step)
    index.insert(0, {"key": key, "host": host, "url": payload.url, "title": payload.title,
                     "step": step, "ts": ts, "bytes": len(data.get("html", "")),
                     "anchors": len(payload.anchors), "tables": len(payload.tables),
                     "apis": len(payload.apis), "extras": len(payload.extras or {})})
    await cache.set_json(_INDEX_KEY, index[:_MAX_INDEX], _TTL)

    logger.info(f"[debug-capture] stored {host} "
                f"({len(data.get('html',''))}B html, {len(payload.anchors)} anchors, "
                f"{len(payload.apis)} apis)")
    return {"ok": True, "host": host, "bytes": len(data.get("html", "")),
            "anchors": len(payload.anchors), "tables": len(payload.tables),
            "apis": len(payload.apis)}


@router.get("/capture/latest")
async def latest(host: str = Query(None), url: str = Query(None), key: str = Query(None),
                 x_debug_token: str | None = Header(default=None)):
    """`?key=` fetches one exact capture (use the `key` from /capture/list — the
    only way to pick a specific step of a same-url wizard); `?url=` fetches the
    step-less capture for that page (host+path); `?host=` returns the MOST RECENT
    capture for that host (there can be several — one per step/path)."""
    _require_token(x_debug_token)
    if key:
        data = await cache.get_json(f"{_NS}:{key}")
        if not data:
            raise HTTPException(status_code=404, detail=f"no capture for key {key}")
        return data
    if url:
        data = await cache.get_json(f"{_NS}:{_key(url)}")
        if not data:
            raise HTTPException(status_code=404, detail=f"no capture for url {url}")
        return data
    if not host:
        raise HTTPException(status_code=400, detail="provide host or url")
    h = host.lower().removeprefix("www.")
    # index is newest-first (insert at 0); first match = most recent for this host.
    for e in (await cache.get_json(_INDEX_KEY) or []):
        if e.get("host") == h and e.get("key"):
            data = await cache.get_json(f"{_NS}:{e['key']}")
            if data:
                return data
    raise HTTPException(status_code=404, detail=f"no capture for host {h}")


@router.get("/capture/list")
async def list_captures(x_debug_token: str | None = Header(default=None)):
    _require_token(x_debug_token)
    return {"captures": await cache.get_json(_INDEX_KEY) or []}


@router.get("/fetch")
async def debug_fetch(url: str = Query(..., max_length=2000),
                      x_debug_token: str | None = Header(default=None)):
    """Diagnostic: fetch `url` from THIS server's IP (Railway) exactly like the
    cron's cheap path, and report what we get — to tell real anti-bot IP blocking
    (403 / Cloudflare challenge) apart from an adapter that merely breaks mid-way.
    Token-gated (off unless DEBUG_CAPTURE_TOKEN is set)."""
    _require_token(x_debug_token)
    import requests
    from app.services.ats_adapters.core import fetch_ats_jobs, is_known_ats_url
    from app.services.url_validator import is_allowed_url_resolved

    # SSRF guard: even token-gated, never let this fetch a private/internal host
    # (resolved check also rejects a public name that DNS-resolves internal).
    if not await is_allowed_url_resolved(url):
        raise HTTPException(status_code=400, detail="url blocked by SSRF guard")

    hdr = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*",
    }
    _CHAL = ("just a moment", "cloudflare", "attention required", "perimeterx",
             "px-captcha", "captcha", "access denied", "enable javascript",
             "cf-browser-verification", "datadome", "/cdn-cgi/challenge")
    _LOGIN = ("vui lòng đăng nhập", "please sign in", "please log in", "login required")
    t0 = time.time()
    out: dict = {"url": url, "from": "railway-server-ip"}
    html = None
    try:
        r = await asyncio.to_thread(
            lambda: requests.get(url, headers=hdr, timeout=15, allow_redirects=True))
        body = r.text or ""
        low = body.lower()
        html = body
        out.update({
            "status": r.status_code,
            "final_url": r.url,
            "server": r.headers.get("server"),
            "cf_ray": r.headers.get("cf-ray"),
            "bytes": len(body),
            "challenge_markers": [m for m in _CHAL if m in low],
            "login_markers": [m for m in _LOGIN if m in low],
            "head": body[:400],
        })
    except Exception as e:
        out["error"] = str(e)[:300]

    out["adapter"] = is_known_ats_url(url)
    try:
        jobs = await asyncio.to_thread(fetch_ats_jobs, url, html)
        out["adapter_jobs"] = len(jobs)
        out["sample"] = [(j.get("title") or "")[:60] for j in jobs[:3]]
    except Exception as e:
        out["adapter_error"] = str(e)[:200]
    out["elapsed_s"] = round(time.time() - t0, 1)
    return out


@router.get("/capture/targets")
async def targets(x_debug_token: str | None = Header(default=None)):
    """URLs the batch-scan button should auto-open + capture (hard JS/anti-bot
    featured sites). The extension walks these one tab at a time."""
    _require_token(x_debug_token)
    return {"targets": [{"name": c.name, "url": c.career_url}
                        for c in FEATURED_COMPANIES if c.name in _CAPTURE_TARGET_NAMES]}
