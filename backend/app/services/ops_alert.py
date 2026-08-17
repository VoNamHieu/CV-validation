"""Operator alerts for career-page drift — Telegram now, incident row for history.

One entry point: ``alert(kind, company, detail, ...)``. Four callers (the
"trang tuyển dụng đổi URL" detectors):

  career_url_moved   — career_url now redirects to a different host
                       (Ahamove: /recruitment → careers.ahamove.com)
  url_scheme_changed — feed still returns jobs but ZERO of them match the
                       identities we had active (GHN: ObjectId → key slug)
  links_broken       — the cron link scan found most of a company's sampled
                       detail URLs dead (empty SPA shell / 404 / gone marker)
  feed_died          — a feed with a real baseline has returned nothing for
                       consecutive cycles (site migrated — or, when the compat
                       log says antibot, our IP is blocked: say THAT instead)

Dedupe rides cache.get_json/set_json (Redis) keyed by fingerprint, so an 8h
cron doesn't re-ring the same bell until the TTL lapses or the operator fixes
the source (which changes the fingerprint's reason to exist). Without Redis it
degrades to one alert per run — telegram.notify's per-minute cap still bounds
the blast radius.

The Telegram send is direct (the cron service just needs TELEGRAM_BOT_TOKEN /
TELEGRAM_CHAT_ID set); the incident row additionally shows up in the admin
"Nhật ký lỗi" tab. If the Supabase→Telegram incident webhook is configured to
forward warnings too, scope it to severity='error' to avoid double messages.
"""
from __future__ import annotations

import logging
import time

from app.services import cache, telegram
from app.services import incidents as incidents_svc

logger = logging.getLogger(__name__)

_NS = "ops_alert:v1:"
_DEFAULT_TTL_DAYS = 7

_KIND_EMOJI = {
    "career_url_moved": "🚚",
    "url_scheme_changed": "🔀",
    "links_broken": "🔗",
    "feed_died": "📉",
}


async def alert(kind: str, company: str, detail: str, *,
                fingerprint: str | None = None,
                ttl_days: int = _DEFAULT_TTL_DAYS,
                context: dict | None = None) -> bool:
    """Send a deduped drift alert. Returns True if it actually fired
    (False = suppressed by the fingerprint window). Never raises."""
    fp = _NS + (fingerprint or f"{kind}:{company}")
    try:
        if await cache.get_json(fp):
            return False
        await cache.set_json(fp, int(time.time()), ttl_days * 24 * 3600)
    except Exception:  # cache is best-effort; a Redis hiccup must not mute the alert
        pass

    emoji = _KIND_EMOJI.get(kind, "⚠️")
    telegram.notify(
        f"{emoji} <b>{telegram.esc(kind)}</b> · {telegram.esc(company)}\n"
        f"{telegram.esc(detail)}")
    try:
        await incidents_svc.report(
            "link_drift", module=f"drift.{kind}", severity="warning",
            message=f"{company}: {detail}",
            context={"company": company, **(context or {})},
        )
    except Exception:  # incidents_svc.report already guards, belt-and-braces
        logger.exception("[ops_alert] incident write failed")
    logger.warning("[ops_alert] %s · %s — %s", kind, company, detail)
    return True
