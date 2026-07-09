"""Inbound webhooks — currently Supabase Database Webhooks for monitoring.

Supabase fires an HTTP POST on row changes (Dashboard → Database → Webhooks);
we transform the payload into a Telegram alert. This is event-driven at the
DATA layer, so it fires on ANY insert (app, cron, or a manual SQL insert) —
not just a specific code path.

Payload shape (INSERT):
    {"type":"INSERT","table":"profiles","schema":"public",
     "record":{...new row...},"old_record":null}

Security: the endpoint is public, so every call must carry
``X-Webhook-Secret: <SUPABASE_WEBHOOK_SECRET>`` (configured as a custom header
on the Supabase webhook). Unset secret → the endpoint is disabled (503).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.services import telegram

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


class SupabaseWebhook(BaseModel):
    # Extra payload fields (schema, old_record) are ignored by default.
    type: str                       # INSERT | UPDATE | DELETE
    table: str
    record: Optional[dict[str, Any]] = None


def _fmt_profile(r: dict) -> str:
    who = r.get("email") or r.get("id") or "?"
    return f"🎉 <b>User mới</b>\n{telegram.esc(str(who))}"


def _fmt_incident(r: dict) -> str:
    sev = r.get("severity") or "error"
    emoji = "🟡" if sev == "warning" else "🔴"
    itype = r.get("incident_type") or "incident"
    src = r.get("source") or "?"
    parts = [f"{emoji} <b>Incident</b> · {telegram.esc(itype)} ({telegram.esc(src)})"]
    if r.get("module"):
        parts.append(f"<b>module:</b> {telegram.esc(str(r['module']))}")
    if r.get("code"):
        parts.append(f"<b>code:</b> {telegram.esc(str(r['code']))}")
    if r.get("message"):
        parts.append(telegram.esc(str(r["message"])[:400]))
    return "\n".join(parts)


_FORMATTERS = {"profiles": _fmt_profile, "incidents": _fmt_incident}


@router.post("/supabase")
async def supabase_webhook(
    body: SupabaseWebhook,
    x_webhook_secret: Optional[str] = Header(default=None),
):
    secret = os.getenv("SUPABASE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook not configured")
    if x_webhook_secret != secret:
        raise HTTPException(status_code=401, detail="Bad webhook secret")

    # Only new rows are alerts; ignore UPDATE/DELETE and unhandled tables so
    # Supabase gets a clean 200 (no retries) either way.
    fmt = _FORMATTERS.get(body.table)
    if body.type == "INSERT" and body.record and fmt:
        telegram.notify(fmt(body.record))
    return {"ok": True}
