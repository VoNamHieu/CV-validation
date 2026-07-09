"""FPT Securities (fpts.com.vn) — ASP.NET careers site. The job feed is a JSON
endpoint (/editor/Surface/CareerBase/GetApplicationPosition) but it 500s unless
called within a session that first loaded the career page (it reads the
ASP.NET_SessionId / SERVERID cookies). So: warm the page, then hit the API with
the session. Each item already carries the JD (Description) and location.
"""
from __future__ import annotations

import time as _time

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_CAREER = "https://www.fpts.com.vn/co-hoi-nghe-nghiep/"
_API = "https://www.fpts.com.vn/editor/Surface/CareerBase/GetApplicationPosition"
_PAGE_SIZE = 100


def _dotnet_ms(s: str | None) -> int | None:
    """Parse ASP.NET '/Date(1786726800000)/' into epoch-ms (None if absent)."""
    m = re.search(r"/Date\((-?\d+)\)/", s or "")
    return int(m.group(1)) if m else None


def _is_fpts(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "fpts.com.vn", "www.fpts.com.vn")


def _fpts(career_url: str) -> list[dict]:
    s = requests.Session()
    s.headers.update({"User-Agent": _HEADERS["User-Agent"]})
    try:
        s.get(_CAREER, timeout=_TIMEOUT)  # sets ASP.NET_SessionId / SERVERID
    except Exception as e:
        logger.info(f"[ats] fpts warm-up failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    now_ms = _time.time() * 1000
    for page in range(1, 8):  # the API caps a company well under 700; stop early anyway
        try:
            r = s.get(_API, timeout=_TIMEOUT, headers={
                "X-Requested-With": "XMLHttpRequest", "Referer": _CAREER,
                "Accept": "application/json, text/javascript, */*",
            }, params={"page": page, "pageSize": _PAGE_SIZE, "arrNganhNghe": "",
                       "arrDiaDiemLamViec": "", "arrLoaiHinhCongViec": "", "keyword": ""})
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data", []) or []
        except Exception as e:
            logger.info(f"[ats] fpts page {page} failed: {str(e)[:80]}")
            break
        if not data:
            break
        for j in data:
            title = (j.get("title") or "").strip()
            jid = j.get("id")
            if not title or jid in seen:
                continue
            # The feed returns the FULL history — most rows are closed (their
            # application deadline has passed, some back in 2024). Drop anything
            # whose deadline is a real date in the past; keep future + unset.
            dl = _dotnet_ms(j.get("deadline"))
            if dl is not None and 0 < dl < now_ms:
                continue
            seen.add(jid)
            # Detail page is /co-hoi-nghe-nghiep/chi-tiet/?id=<jid>. The bare
            # /co-hoi-nghe-nghiep/<slug> (no chi-tiet/) the adapter used before
            # just redirects to the LISTING (?id=… on the base path) — the job
            # never shows. Key on the numeric id (stable, no unicode-slug
            # encoding issues); fall back to the slug path only if id is absent.
            link = (j.get("titleLink") or "").strip()
            out.append({
                "title": title[:200],
                "url": f"{_CAREER}chi-tiet/?id={jid}" if jid else (
                    f"{_CAREER}chi-tiet/{link}" if link else _CAREER),
                "location": (j.get("LocationName") or "").strip(),
                "description": _strip_html(j.get("Description") or j.get("jobsummary") or ""),
                "category": (j.get("TeamName") or "").strip(),
            })
        if len(data) < _PAGE_SIZE or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] fpts → {len(out)} jobs")
    return out


__all__ = ["_is_fpts", "_fpts"]
