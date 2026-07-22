"""VN location → province-level signal.

The stored ``location`` field is free-form scraped text: country suffixes
("Ho Chi Minh City, VN"), language/spelling variants of the same city ("TP. Ho
Chi Minh" / "Thành phố Hồ Chí Minh" / "HCMC"), district/street prefixes
("Dist.7, Ho Chi Minh"), repeated tokens ("Hồ Chí Minh, Hồ Chí Minh, Hồ Chí
Minh"), multi-province lists, and outright non-locations ("Ban Giám Đốc Chi
Nhánh Miền Nam"). For grouping and display we only need the PROVINCE.

``canon_provinces`` folds a raw string down to the ordered, de-duplicated list
of canonical province names it mentions. We deliberately do NOT apply the 2025
province-merger remap (Vĩnh Phúc→Phú Thọ, …) — that mapping is easy to get wrong
and the data already carries both old and new names; we just canonicalize the
SPELLING of whatever province name appears, so the same place stops showing up
as five different strings.
"""
from __future__ import annotations

import re
import unicodedata

# Canonical (accent-correct) province name → extra folded aliases beyond the
# folded canonical name itself. Big cities carry English/abbrev/old-district
# forms; provinces mostly just need their own folded name (added automatically).
_PROVINCES: dict[str, list[str]] = {
    "Hồ Chí Minh": ["ho chi minh", "hochiminh", "sai gon", "saigon", "thu duc",
                     "hcm", "hcmc", "tphcm", "hcm city", "sg"],
    "Hà Nội":      ["ha noi", "hanoi", "thang long", "hn", "tphn"],
    "Đà Nẵng":     ["da nang", "danang"],
    "Hải Phòng":   ["hai phong", "haiphong"],
    "Cần Thơ":     ["can tho", "cantho"],
    "Huế":         ["hue", "thua thien hue", "thua thien"],
    "An Giang": [], "Bà Rịa - Vũng Tàu": ["ba ria vung tau", "vung tau", "ba ria"],
    "Bắc Giang": [], "Bắc Kạn": ["bac kan"], "Bạc Liêu": [], "Bắc Ninh": [],
    "Bến Tre": [], "Bình Định": [], "Bình Dương": [], "Bình Phước": [],
    "Bình Thuận": [], "Cà Mau": [], "Cao Bằng": [], "Đắk Lắk": ["dak lak", "daklak", "dac lac"],
    "Đắk Nông": ["dak nong"], "Điện Biên": [], "Đồng Nai": [], "Đồng Tháp": [],
    "Gia Lai": [], "Hà Giang": [], "Hà Nam": [], "Hà Tĩnh": [], "Hải Dương": [],
    "Hậu Giang": [], "Hòa Bình": [], "Hưng Yên": [], "Khánh Hòa": ["khanh hoa", "nha trang"],
    "Kiên Giang": ["kien giang", "phu quoc"], "Kon Tum": [], "Lai Châu": [],
    "Lâm Đồng": ["lam dong", "da lat", "dalat"], "Lạng Sơn": [],
    "Lào Cai": ["lao cai", "sa pa", "sapa"], "Long An": [], "Nam Định": [],
    "Nghệ An": [], "Ninh Bình": [], "Ninh Thuận": ["ninh thuan", "phan rang"],
    "Phú Thọ": [], "Phú Yên": [], "Quảng Bình": [], "Quảng Nam": [],
    "Quảng Ngãi": [], "Quảng Ninh": ["quang ninh", "ha long"], "Quảng Trị": [],
    "Sóc Trăng": [], "Sơn La": [], "Tây Ninh": [], "Thái Bình": [],
    "Thái Nguyên": [], "Thanh Hóa": [], "Tiền Giang": [], "Trà Vinh": [],
    "Tuyên Quang": [], "Vĩnh Long": [], "Vĩnh Phúc": [], "Yên Bái": [],
}


def _fold(s: str) -> str:
    """lower + strip accents (đ→d) + punctuation→space + collapse whitespace."""
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _build_matchers() -> list[tuple[re.Pattern, str]]:
    """(word-boundary regex, canonical) pairs, LONGEST alias first so a specific
    alias ('ba ria vung tau') wins over a contained shorter one ('vung tau')."""
    pairs: list[tuple[str, str]] = []
    for canon, aliases in _PROVINCES.items():
        for a in {_fold(canon), *aliases}:
            if a:
                pairs.append((a, canon))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return [(re.compile(rf"\b{re.escape(a)}\b"), c) for a, c in pairs]


_MATCHERS = _build_matchers()

# A segment led by a sub-province admin word is a WARD/DISTRICT, not a province —
# and its name can collide with a province ("Phường Vĩnh Phúc" is a ward inside
# Phú Thọ, not Vĩnh Phúc province). We skip these on the first pass so the real
# province (a later bare segment) wins, and only fall back to them if nothing
# else matched.
_SUBUNIT_PREFIX = re.compile(
    r"^(phuong|xa|quan|huyen|thi xa|thi tran|district|dist|ward|khu pho|"
    r"to dan pho|thon|ap|kcn|kdt)\b")


def _match_seg(f: str, out: list[str]) -> None:
    for rx, canon in _MATCHERS:
        if rx.search(f) and canon not in out:
            out.append(canon)
            return


def canon_provinces(raw: str | None) -> list[str]:
    """Ordered, de-duplicated canonical provinces mentioned in ``raw``.

    Splits on comma/slash/semicolon/pipe so a multi-site posting ("An Giang, Cà
    Mau, …") yields each province, and junk segments ("VP. Phu Nu", "District 2")
    that carry no province simply contribute nothing. Empty when no province is
    recognised (e.g. a department name mis-scraped into the location)."""
    if not raw or not raw.strip():
        return []
    segs = [(_fold(s), _fold(s)) for s in re.split(r"[,/;|]+", raw)]
    folded = [f for f, _ in segs if f]
    out: list[str] = []
    # Pass 1: province-level segments only.
    for f in folded:
        if not _SUBUNIT_PREFIX.match(f):
            _match_seg(f, out)
    # Pass 2: fall back to ward/district segments only if nothing matched.
    if not out:
        for f in folded:
            _match_seg(f, out)
    return out


def primary_province(raw: str | None) -> str | None:
    """The first canonical province in ``raw``, or None when none is found."""
    provs = canon_provinces(raw)
    return provs[0] if provs else None


def clean_location(raw: str | None) -> str | None:
    """Canonical, de-duplicated location string for storage ("Hồ Chí Minh, Hồ
    Chí Minh, Hồ Chí Minh" → "Hồ Chí Minh"). Returns None when no province is
    recognised — callers keep the original rather than blank a real-but-unmapped
    value (e.g. "Remote", a foreign city)."""
    provs = canon_provinces(raw)
    return ", ".join(provs) if provs else None
