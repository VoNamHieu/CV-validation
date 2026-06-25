"""Controlled vocabulary for facet search (Phase 1 of the search engine).

Two hand-curated coarse layers + a weighted role-adjacency graph. Fine-grained
specialization is intentionally NOT hand-authored here — embeddings handle
fine adjacency, and specializations are meant to be derived from job-embedding
clusters later (see search-design). Keep this file COARSE and stable.

Layers:
  Industry      — behavior-driven (split when the role-mix differs, e.g.
                  E-commerce ≠ SaaS: Seller Ops / Category / Livestream).
  Role family   — what kind of work (Engineering, Product, …).
  Adjacency     — weighted pivots BETWEEN role families (query-time recall),
                  small + interpretable + tunable. NOT extended to specializations.
"""
from __future__ import annotations

import re

# ── INDUSTRIES (behavior-driven, ~17) ────────────────────────────────────────
INDUSTRIES = (
    "E-commerce & Marketplace",      # Shopee, Lazada, TikTok Shop — Seller Ops, Category, Livestream
    "Technology Platform / SaaS",    # VNG, KiotViet, Klook, Agoda, Be, Grab (superapp)
    "Fintech & Payments",            # MoMo, VNPAY, Visa, Mastercard, Cake
    "IT Services / Outsourcing",     # FPT Software, NashTech, KMS, TMA, Rikkeisoft, CMC
    "Banking",                       # Vietcombank, Techcombank, …
    "Securities & Investment",       # VPS, TCBS, VCBS, VPBankS, FPT Securities
    "Insurance",                     # Manulife, Prudential, Bảo Việt
    "FMCG & Consumer Goods",         # Nestlé, Unilever, Vinamilk, Masan, Heineken
    "Retail",                        # WinMart, PNJ, Thế Giới Di Động, Highlands, Nike
    "Logistics & Delivery",          # GHN, Viettel Post, DHL, J&T, NinjaVan
    "Manufacturing & Semiconductor", # Marvell, Renesas, Infineon, Canon, Bosch, Samsung
    "Industrial / Energy / Auto",    # Schneider, ABB, Air Liquide, VinFast
    "Pharma & Healthcare",           # Vinmec, Pharmacity
    "Consulting & Professional",     # McKinsey, PwC, EY, KPMG, Deloitte
    "Agency / Media / Marketing",    # Ogilvy, Dentsu, CleverAds, SEONGON, Vietcetera
    "Hospitality & Travel",          # Hyatt, Hilton, IHG
    "Education",                     # Apollo, Vinschool
    "Conglomerate / Other",          # catch-all (Vingroup corp, …)
)

# ── ROLE FAMILIES (~13) ──────────────────────────────────────────────────────
ROLE_FAMILIES = (
    "Engineering",
    "Data & AI",
    "Product",
    "Design",
    "Marketing",
    "Sales & BD",
    "Finance & Accounting",
    "Operations",                 # incl. supply chain, seller/category/commerce ops
    "Human Resources",
    "Legal, Risk & Compliance",
    "Customer Service",
    "Manufacturing & Technician", # công nhân / kỹ thuật viên nhà máy (FMCG, semiconductor)
    "General & Management",       # management trainee, strategy, consultant, GM, PM/PMO
)

# ── WEIGHTED ADJACENCY (role-family level only) ──────────────────────────────
# How transferable is a candidate of family A into a job of family B (0–1).
# Used at query time to expand a CV's target families to adjacent ones with a
# score multiplier. Small graph on purpose — embeddings handle finer nuance.
ROLE_ADJACENCY: dict[str, dict[str, float]] = {
    # G&M kept at 0.60 (was 0.85): it's a heterogeneous catch-all (PM/PMO is
    # product-adjacent, but so are strategy/director/consultant, which are not).
    # At 0.85 it outranked the cleaner Data&AI/Marketing pivots inside the
    # adjacent tier; 0.60 lines it up with them. Ordering across tiers is handled
    # by is_primary in rank_jobs + ranker.rerank, not by this weight.
    "Product":            {"General & Management": 0.60, "Data & AI": 0.65, "Marketing": 0.60, "Engineering": 0.50},
    "Engineering":        {"Data & AI": 0.75, "Product": 0.50},
    "Data & AI":          {"Engineering": 0.75, "Product": 0.65, "Finance & Accounting": 0.60},
    "Marketing":          {"Sales & BD": 0.75, "Product": 0.60, "Design": 0.55, "Customer Service": 0.40},
    "Sales & BD":         {"Marketing": 0.75, "Customer Service": 0.60, "Operations": 0.50},
    "Design":             {"Product": 0.60, "Marketing": 0.55},
    "Finance & Accounting": {"Data & AI": 0.60, "Operations": 0.50, "General & Management": 0.45},
    "Operations":         {"Sales & BD": 0.50, "General & Management": 0.60, "Customer Service": 0.45},
    "Customer Service":   {"Sales & BD": 0.60, "Operations": 0.45},
    "Human Resources":    {"General & Management": 0.50},
    "Legal, Risk & Compliance": {"Finance & Accounting": 0.45, "General & Management": 0.40},
    "Manufacturing & Technician": {"Operations": 0.55, "Engineering": 0.40},
    "General & Management": {"Product": 0.60, "Operations": 0.55},
}


# A reverse edge (B→family inferred from family→B... actually the other way) is
# weaker than the authored forward edge — transferring back into a family you
# only pivoted out of is a bit harder. Decay keeps the asymmetry without making
# the graph a one-way street.
_REVERSE_DECAY = 0.8


def adjacent_families(family: str, threshold: float = 0.5) -> dict[str, float]:
    """{adjacent_family: weight} the candidate could pivot into (self = 1.0).

    Symmetric-closure: if some family `src` lists `family` as a neighbour
    (src→family) but the reverse is not authored, treat family→src as a decayed
    edge. This fixes one-directional dead-ends generically (e.g. Design→Product
    authored but not Product→Design) — graph-structure, not per-pair tuning."""
    out = {family: 1.0}
    for fam, w in ROLE_ADJACENCY.get(family, {}).items():
        if w >= threshold:
            out[fam] = w
    for src, edges in ROLE_ADJACENCY.items():
        if src == family:
            continue
        w = edges.get(family)
        if w is None:
            continue
        rev = w * _REVERSE_DECAY
        if rev >= threshold and rev > out.get(src, 0.0):
            out[src] = rev
    return out


# ── TITLE → ROLE FAMILY classifier (rule-based, deterministic, no LLM) ───────
# Ordered, accent-insensitive keyword rules. First match wins; specific before
# generic. Returns (family, confidence). Vietnamese + English keywords.
_RULES: list[tuple[str, str]] = [
    # Manufacturing / technician (check early — "công nhân", "kỹ thuật viên")
    ("Manufacturing & Technician", r"cong nhan|cn |van hanh may|lo hoi|technician|ky thuat vien|operator|assembl|machinist|qa\b.*line|cong nhan dien"),
    # Explicit Product roles — checked BEFORE Data&AI so "AI Product Owner" /
    # "Data Product Manager" resolve to the role (Product), not the specialization.
    ("Product", r"product (owner|manager|management|lead|director|head|supervisor|executive|associate|specialist|intern|develop)|head of product|quan ly san pham"),
    # Data & AI  (business analyst lives here, NOT Product — it's analytics/
    # requirements work, adjacent to Product but a distinct, lower tier)
    ("Data & AI", r"data scien|data engineer|machine learn|\bml\b|\bai\b|data analyst|business analyst|business intelligence|analytics|data steward|big data|\bmis\b|phan tich nghiep vu"),
    # Engineering / software (incl. semiconductor: VLSI / ASIC / IC & chip design
    # / verification / layout — checked before Design & Finance so "Analog IC
    # Design" / "Memory Controller Verification" land here, not on Design's
    # "design" or Finance's "controller"). Bare "kỹ thuật" deliberately NOT a
    # signal: it collides with "kỹ thuật số" (digital), "kỹ thuật SEO" (mktg) and
    # maintenance/construction technicians (→ Manufacturing).
    ("Engineering", r"software|developer|\bdev\b|engineer|lap trinh|backend|frontend|full.?stack|devops|\bsre\b|\bqa\b|tester|mobile|android|ios|embedded|firmware|system|infra|cloud|\bit\b.*(engineer|developer|support|operation)|ky su(?!.*ban)|semiconductor|\bvlsi\b|\basic\b|\bfpga\b|\brtl\b|verilog|silicon|\bic design|chip verification|functional verification|ip verification|design verification|memory controller|\blayout\b"),
    # Product  (business analyst moved to Data & AI; bare \bba\b dropped — it
    # false-matches VN "Bà"/"Ba")
    ("Product", r"product manage|product owner|product lead|product assistant|product specialist|product analyst|quan ly san pham|tech product"),
    # Design
    # "design" only as a design-role (Design Intern/Lead/Manager…) or a visual
    # design discipline — NOT bare "design", which collides with process /
    # business / IC design (those resolve to Ops / G&M / Engineering instead).
    ("Design", r"designer|design (intern|lead|manager|director|head|team|associate|specialist|trainee|ops|operation)|ux design|ui design|product design|graphic design|visual design|web design|service design|brand design|\bux\b|\bui\b|graphic|creative|art director|thiet ke|motion|illustrat|copywriter|copy writer"),
    # Marketing  (drop bare \bpr\b — collides with VN; keep full comms terms)
    ("Marketing", r"marketing|\bbrand\b|growth|content|seo|digital mkt|truyen thong|thuong hieu|public relations|communicat|social|\bcrm\b|campaign|trade marketing|\bmkt\b|strategist"),
    # Legal / Risk / Compliance — BEFORE Sales/Finance: these signals are
    # unambiguous, but bank compliance/risk titles also contain "khách hàng"/
    # "tài chính" which would otherwise be grabbed by Sales/Finance first.
    ("Legal, Risk & Compliance", r"legal|phap che|phap ly|compliance|tuan thu|\brisk\b|rui ro|quan tri rui ro|regulat|aml|phong chong rua tien"),
    # Sales & BD (incl. VN bank relationship-manager roles — high volume)
    ("Sales & BD", r"sales|\bsale\b|ban hang|kinh doanh|business develop|account manager|account executive|partnership|relationship manager|\bbd\b|telesale|merchant|distribution|giam sat ban hang|khach hang ca nhan|khach hang doanh nghiep|khach hang lon|quan he khach hang|\bkhcn\b|\bkhdn\b|tu van tin dung|phat trien khach hang"),
    # Finance & Accounting (incl. credit / valuation — VN banks)
    ("Finance & Accounting", r"finance|financ|accountant|accounting|ke toan|tai chinh|audit|kiem toan|treasury|actuar|dinh phi|tax|thue|fp&a|controller|kiem soat|tham dinh (gia|tin dung)|tin dung|credit|dinh gia|thu hoi no|phan tich.*tai chinh|giao dich vien|\bgdv\b|kiem ngan|teller"),
    # HR
    ("Human Resources", r"human resource|\bhr\b|hrbp|recruit|tuyen dung|talent|nhan su|c&b|learning.*develop|\bl&d\b|dao tao|compensation|payroll|employer brand"),
    # Customer Service (incl. Customer Success / Experience)
    ("Customer Service", r"customer (service|support|success|experience)|cham soc khach hang|\bcskh\b|call center|contact center|dich vu khach hang|tong dai|support agent|customer success"),
    # Operations / supply chain / commerce ops
    ("Operations", r"operation|van hanh|supply chain|chuoi cung ung|logistic|warehouse|kho|fulfil|category|seller|merchandis|procure|mua hang|thu mua|planning|planner|inventory|dieu phoi|giao nhan|vendor|optimization"),
    # General & management (catch-all-ish, check late)
    ("General & Management", r"management trainee|\bmt\b program|strategy|chien luoc|consultant|tu van|general manager|\bgm\b|director|head of|truong phong|truong bo phan|project manager|program manager|\bpmo\b|quan ly du an|giam doc|pho phong|chief|\bceo\b|\bcoo\b|\bcfo\b|\bcto\b"),
]
_COMPILED = [(fam, re.compile(rx, re.I)) for fam, rx in _RULES]

_ACCENT = str.maketrans(
    "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ",
    "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd")


def _norm(s: str) -> str:
    # lower() FIRST — _ACCENT only maps lowercase chars, so all-caps VN titles
    # ("CHUYÊN VIÊN DỊCH VỤ…") must be lowered before accent-folding.
    return (s or "").lower().translate(_ACCENT)


# Confidence a rule match carries vs the General & Management catch-all. The
# fallback is deliberately low so score_job can demote titles we couldn't really
# classify (an intern / "Creator Manager" that only lands on the catch-all).
FULL_CONFIDENCE = 0.8
FALLBACK_CONFIDENCE = 0.3


def classify_title(title: str) -> tuple[str, float]:
    """(role_family, confidence). Falls back to General & Management @0.3."""
    n = _norm(title)
    for fam, rx in _COMPILED:
        if rx.search(n):
            return fam, FULL_CONFIDENCE
    return "General & Management", FALLBACK_CONFIDENCE


# ── SENIORITY (ordered low → high) ───────────────────────────────────────────
# A separate axis from role family: a "Product Manager" and a "Product Intern"
# share a family but not a level. Used to demote jobs BELOW the candidate's
# level (an intern role for a mid/senior candidate).
SENIORITY_LEVELS = (
    "Intern/Fresher", "Junior", "Mid", "Senior", "Lead/Manager", "Director/Head+",
)
_LEVEL_INDEX = {lv: i for i, lv in enumerate(SENIORITY_LEVELS)}

# Title → seniority keyword rules (specific → generic, first match wins).
# Bare "manager" is INTENTIONALLY not a signal: a "Product Manager" is a mid IC
# role, not Lead — only explicit lead/principal/head/senior/junior/intern words
# move the level. Titles with no signal return None (→ no seniority penalty).
_SENIORITY_RULES: list[tuple[str, str]] = [
    ("Intern/Fresher", r"\bintern(ship)?\b|fresher|thuc tap|sinh vien|\btts\b"),
    ("Director/Head+", r"director|head of|\bhead\b|chief|\bc[efimot]o\b|\bvp\b|svp|evp|vice president|giam doc|truong phong|truong bo phan|pho phong"),
    ("Lead/Manager",   r"\blead\b|principal|\bstaff\b"),
    ("Senior",         r"\bsenior\b|\bsr\b|cao cap|chuyen gia|chuyen vien cao cap"),
    ("Junior",         r"\bjunior\b|\bjr\b|entry[ -]?level|moi ra truong|tap su"),
]
_SENIORITY_COMPILED = [(lv, re.compile(rx, re.I)) for lv, rx in _SENIORITY_RULES]


def classify_seniority(title: str) -> str | None:
    """Seniority level label for a title, or None when it carries no signal."""
    n = _norm(title)
    for lv, rx in _SENIORITY_COMPILED:
        if rx.search(n):
            return lv
    return None


def level_index(level: str) -> int | None:
    """Ordinal position of a seniority label (0 = Intern), or None if unknown."""
    return _LEVEL_INDEX.get(level)


# Loose level strings (CV-extractor "current_level", API callers) → canonical
# SENIORITY_LEVELS. Lets the seniority signal engage even when the input isn't
# already vocab-exact ("Lead", "Mid-level", "thực tập" → canonical).
_LEVEL_ALIASES: list[tuple[str, str]] = [
    (r"intern|fresher|thuc tap|sinh vien", "Intern/Fresher"),
    (r"director|head|chief|\bc[efimot]o\b|\bvp\b|svp|evp|giam doc|truong phong", "Director/Head+"),
    (r"lead|principal|manager|\bstaff\b|quan ly|truong nhom", "Lead/Manager"),
    (r"senior|\bsr\b|cao cap", "Senior"),
    (r"junior|\bjr\b|entry|moi ra truong|tap su", "Junior"),
    (r"mid|middle|intermediate|trung cap", "Mid"),
]
_LEVEL_ALIAS_COMPILED = [(re.compile(rx, re.I), lv) for rx, lv in _LEVEL_ALIASES]


def canon_level(level: str) -> str:
    """Map a loose level string to a canonical SENIORITY_LEVELS label, or ""."""
    if not level:
        return ""
    if level in _LEVEL_INDEX:
        return level
    n = _norm(level)
    for rx, lv in _LEVEL_ALIAS_COMPILED:
        if rx.search(n):
            return lv
    return ""
