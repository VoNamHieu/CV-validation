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
_MAX_ATS_JOBS = 300   # per-company cap across all adapters. Raised 100→300 after
# a pagination audit found big VN boards (zalo 113, vnpt 145, f88 109, mbbank
# 2790) silently capped at 100. 300 covers today's real boards while bounding a
# mega-board (mbbank) so one employer can't flood the pool / embedding budget.
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
    # Some ATS APIs (e.g. Greenhouse) return HTML with its angle brackets
    # entity-encoded (&lt;div&gt;…); unescape first so the tags parse into text
    # instead of surviving as literal "&lt;" noise in the JD.
    if "&lt;" in s and "&gt;" in s:
        s = _html.unescape(s)
    if "<" in s and ">" in s:
        from bs4 import BeautifulSoup
        return BeautifulSoup(s, "html.parser").get_text(separator="\n", strip=True)
    return s


_FULL_JD_CAP = 12000  # sanity bound; matches db.promoted._MAX_SNAPSHOT_DESC


def _full_desc(raw: str | None, cap: int = _FULL_JD_CAP) -> str:
    """Full-or-blank listing description: strip HTML and keep the text only
    when it plausibly IS the whole posting. Teaser-by-nature fields
    (descriptionTeaser, description_short, JobSummary, …) must not come
    through here — write description="" at the call site instead. Over-cap
    text also stores "" rather than a cut stump: a half-JD in the store reads
    as complete and short-circuits every full-JD fallback downstream
    (jd_resolver → Playwright / extension DOM)."""
    txt = _strip_html(raw or "")
    return txt if len(txt) <= cap else ""


_HTML_HEADERS = {"User-Agent": _HEADERS["User-Agent"], "Accept": "text/html,*/*"}


def _detail_desc(url: str, selector: str, keep_form: bool = False) -> str:
    """Full JD from an SSR detail page: GET + the largest CSS `selector` match's
    text, through _full_desc ("" on any miss). For adapters whose listing has no
    JD but whose detail page is server-rendered with a stable container.
    Largest-match (not first) so multi-block layouts (Elementor, repeated
    wrappers) resolve to the content block, not a header stub. `keep_form` is
    for apply-on-page sites (Honda, DOJI, FE Credit) that render the JD INSIDE
    the application <form> — stripping it there strips the posting itself."""
    from bs4 import BeautifulSoup
    try:
        r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        soup = BeautifulSoup(r.text, "html.parser")
        drop = ["script", "style", "nav", "header", "footer"]
        for t in soup(drop if keep_form else drop + ["form"]):
            t.decompose()
        texts = [el.get_text("\n", strip=True) for el in soup.select(selector)]
        return _full_desc(max(texts, key=len, default=""))
    except Exception as e:
        logger.info(f"[ats] detail {url[:60]} failed: {str(e)[:60]}")
        return ""


def _jsonld_desc(url: str) -> str:
    """Full JD from a detail page's schema.org JobPosting JSON-LD ("" on miss)."""
    import json as _json
    try:
        r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>',
                             r.text, re.S):
            try:
                d = _json.loads(m.group(1).strip())
            except Exception:
                continue
            for it in (d if isinstance(d, list) else [d]):
                if isinstance(it, dict) and it.get("@type") in ("JobPosting", ["JobPosting"]):
                    desc = _full_desc(it.get("description") or "")
                    if desc:
                        return desc
    except Exception as e:
        logger.info(f"[ats] jsonld {url[:60]} failed: {str(e)[:60]}")
    return ""

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


# Short standalone location codes some ATS emit instead of a city/country name:
# ISO "VN"/"VNM" (SuccessFactors → Masan) and city abbreviations "HCM"/"HN"
# (FE Credit). Matched at word boundaries so "hn" doesn't hit "johnson" etc.
_VN_ABBR_RX = re.compile(r"\b(vn|vnm|hcm|hn)\b", re.I)


def _is_vn_loc(loc: str) -> bool:
    l = (loc or "").lower()
    return any(m in l for m in _VN_MARKERS) or bool(_VN_ABBR_RX.search(loc or ""))


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
        # A title carrying markup is never a job — it's page copy harvested as
        # innerHTML (spa_sniff minted 6 fake "jobs" from Dentsu's Workday
        # footer: "<p><b><span>Dream loud…"). Real titles never contain tags.
        if re.search(r"<[a-zA-Z/!]", title):
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
    "_FULL_JD_CAP", "_full_desc", "_detail_desc", "_jsonld_desc",
    "_HTML_HEADERS", "_JSON_POST", "_VN_MARKERS", "_WD_RX", "_is_vn_loc",
    "_BAD_TITLES", "_norm_title", "_finalize",
]
