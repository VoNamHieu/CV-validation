"""Shared helpers + constants for the ATS adapters.

No dependency on the adapter modules or `core` → safe to import from all of
them (breaks the core↔adapters cycle). `from ._shared import *` pulls the
underscore-prefixed helpers via __all__ below.
"""
from __future__ import annotations

import html as _html
import logging
import os
import re
from urllib.parse import urljoin, urlparse, parse_qsl

import requests

logger = logging.getLogger("app.services.ats_adapters")

_TIMEOUT = 12
_MAX_ATS_JOBS = 100   # per-company cap across all adapters
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}


def _get_json(url: str):
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        if r.status_code == 200 and r.text:
            return r.json()
        logger.info(f"[ats] {url} → HTTP {r.status_code}")
    except Exception as e:
        logger.info(f"[ats] {url} failed: {str(e)[:80]}")
    return None


def _strip_html(s: str) -> str:
    if not s:
        return ""
    if "<" in s and ">" in s:
        from bs4 import BeautifulSoup
        return BeautifulSoup(s, "html.parser").get_text(separator="\n", strip=True)
    return s


_HTML_HEADERS = {"User-Agent": _HEADERS["User-Agent"], "Accept": "text/html,*/*"}

_JSON_POST = {"User-Agent": "Mozilla/5.0 Chrome/120", "Accept": "application/json",
              "Content-Type": "application/json"}
_VN_MARKERS = ("vietnam", "viet nam", "việt nam", "hanoi", "ha noi", "hà nội",
               "ho chi minh", "hồ chí minh", "hcmc", "tp.hcm", "tp hcm", "tphcm",
               "saigon", "sài gòn", "sai gon", "da nang", "đà nẵng", "hai phong",
               "hải phòng", "can tho", "cần thơ", "binh duong", "bình dương",
               "bac ninh", "bắc ninh", "dong nai", "đồng nai", "vung tau",
               "vũng tàu", "long an", "hung yen", "hưng yên", "thai nguyen",
               "thái nguyên", "quang ninh", "bien hoa", ", vn")
_WD_RX = re.compile(r"https?://([^.]+)\.(wd\d+)\.myworkdayjobs\.com(/[^?]*)?", re.I)


def _is_vn_loc(loc: str) -> bool:
    l = (loc or "").lower()
    return any(m in l for m in _VN_MARKERS)


_BAD_TITLES = {
    "trang chu", "tuyen dung", "viec lam", "co hoi nghe nghiep", "co hoi viec lam",
    "tuyen dung hot", "tuyen dung moi", "tat ca viec lam", "xem toan bo tin",
    "opportunities", "job search", "search jobs", "all jobs", "view all jobs",
    "apply", "ung tuyen",
}


def _norm_title(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D").lower().strip()


def _finalize(jobs: list[dict]) -> list[dict]:
    """Single exit gate for every adapter: keep title+url rows, drop nav/section
    labels and date-range rows, dedup by url then by (title, location), cap per
    company. Location is part of the title key because big employers (banks,
    retail, logistics) legitimately post the SAME title per city — those are
    distinct jobs, not duplicates."""
    out, seen_url, seen_title = [], set(), set()
    for j in jobs:
        title = (j.get("title") or "").strip()
        url = j.get("url") or ""
        if not title or not url or len(title) < 4:
            continue
        nt = _norm_title(title)
        if nt in _BAD_TITLES or nt.startswith(("tu ngay ", "from ")):  # date-range rows (Canon)
            continue
        tkey = (nt[:80], _norm_title(str(j.get("location") or ""))[:40])
        if url in seen_url or tkey in seen_title:
            continue
        seen_url.add(url)
        seen_title.add(tkey)
        out.append(j)
        if len(out) >= _MAX_ATS_JOBS:
            break
    return out


__all__ = [
    "logger", "_html", "os", "re", "requests", "urljoin", "urlparse", "parse_qsl",
    "_TIMEOUT", "_MAX_ATS_JOBS", "_HEADERS", "_get_json", "_strip_html",
    "_HTML_HEADERS", "_JSON_POST", "_VN_MARKERS", "_WD_RX", "_is_vn_loc",
    "_BAD_TITLES", "_norm_title", "_finalize",
]
