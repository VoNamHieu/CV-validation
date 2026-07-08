"""FPT Securities (fpts.com.vn) — ASP.NET careers site. The job feed is a JSON
endpoint (/editor/Surface/CareerBase/GetApplicationPosition) but it 500s unless
called within a session that first loaded the career page (it reads the
ASP.NET_SessionId / SERVERID cookies). So: warm the page, then hit the API with
the session. Each item already carries the JD (Description) and location.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_CAREER = "https://www.fpts.com.vn/co-hoi-nghe-nghiep/"
_API = ("https://www.fpts.com.vn/editor/Surface/CareerBase/GetApplicationPosition"
        "?page=1&pageSize=100&arrNganhNghe=&arrDiaDiemLamViec=&arrLoaiHinhCongViec=&keyword=")


def _is_fpts(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "fpts.com.vn", "www.fpts.com.vn")


def _fpts(career_url: str) -> list[dict]:
    s = requests.Session()
    s.headers.update({"User-Agent": _HEADERS["User-Agent"]})
    try:
        s.get(_CAREER, timeout=_TIMEOUT)  # sets ASP.NET_SessionId / SERVERID
        r = s.get(_API, timeout=_TIMEOUT, headers={
            "X-Requested-With": "XMLHttpRequest", "Referer": _CAREER,
            "Accept": "application/json, text/javascript, */*",
        })
        if r.status_code != 200:
            logger.info(f"[ats] fpts API HTTP {r.status_code}")
            return []
        data = (r.json() or {}).get("data", []) or []
    except Exception as e:
        logger.info(f"[ats] fpts failed: {str(e)[:80]}")
        return []
    out = []
    for j in data:
        title = (j.get("title") or "").strip()
        if not title:
            continue
        link = (j.get("titleLink") or "").strip()
        url = urljoin(_CAREER, link) if link else f"{_CAREER}{j.get('id', '')}"
        out.append({
            "title": title[:200],
            "url": url,
            "location": (j.get("LocationName") or "").strip(),
            "description": _strip_html(j.get("Description") or j.get("jobsummary") or ""),
            "category": (j.get("TeamName") or "").strip(),
        })
    logger.info(f"[ats] fpts → {len(out)} jobs")
    return out


__all__ = ["_is_fpts", "_fpts"]
