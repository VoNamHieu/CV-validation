"""Fire-and-forget Telegram notifications for operator monitoring.

Sends to a bot chat via the Telegram Bot API. A no-op when
``TELEGRAM_BOT_TOKEN`` / ``TELEGRAM_CHAT_ID`` aren't set, so it's safe to leave
the call sites in place before the bot is configured. Never raises — a
monitoring outage must not break the request that triggered it.

Set up:
  1. @BotFather → /newbot → get the bot token.
  2. DM the bot (or add it to a group) and read chat.id from
     https://api.telegram.org/bot<TOKEN>/getUpdates
  3. Env: TELEGRAM_BOT_TOKEN=... , TELEGRAM_CHAT_ID=...
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

_API = "https://api.telegram.org/bot{token}/sendMessage"

# Anti-flood: cap messages per rolling minute so an error storm (or a burst of
# signups) can't spam the chat or trip Telegram's own rate limit. Excess is
# dropped; one "suppressed" summary is sent when a window first overflows.
_MAX_PER_MIN = 20
_recent: list[float] = []
_suppressed_notice_sent = False

# Hold task refs so fire-and-forget tasks aren't garbage-collected mid-flight.
_tasks: set[asyncio.Task] = set()


def _creds() -> tuple[str, str] | None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    return (token, chat) if token and chat else None


async def _send(text: str) -> None:
    creds = _creds()
    if not creds:
        return
    token, chat = creds
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                _API.format(token=token),
                json={
                    "chat_id": chat,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
            )
        if r.status_code != 200:
            logger.warning("[telegram] send %s: %s", r.status_code, r.text[:160])
    except Exception as e:  # noqa: BLE001 — notifications must never raise
        logger.warning("[telegram] send failed: %s", str(e)[:160])


def notify(text: str) -> None:
    """Schedule a Telegram message. Non-blocking, no-op if unconfigured, never
    raises. Drops messages past the per-minute cap to avoid flooding."""
    global _suppressed_notice_sent
    if not _creds():
        return

    now = time.monotonic()
    _recent[:] = [t for t in _recent if now - t < 60]
    if len(_recent) >= _MAX_PER_MIN:
        if not _suppressed_notice_sent:
            _suppressed_notice_sent = True
            text = f"⚠️ Nhiều thông báo trong 1 phút — tạm chặn để chống spam (>{_MAX_PER_MIN}/phút)."
        else:
            return
    else:
        _suppressed_notice_sent = False
    _recent.append(now)

    try:
        task = asyncio.create_task(_send(text))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except RuntimeError:
        # No running event loop (called from a sync context) — skip silently.
        pass


def esc(s: str | None) -> str:
    """Minimal HTML escape for values interpolated into a parse_mode=HTML message."""
    if not s:
        return ""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
