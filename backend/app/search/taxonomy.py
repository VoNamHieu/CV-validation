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
    "Product":            {"General & Management": 0.85, "Data & AI": 0.65, "Marketing": 0.60, "Engineering": 0.50},
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


def adjacent_families(family: str, threshold: float = 0.5) -> dict[str, float]:
    """{adjacent_family: weight} the candidate could pivot into (self = 1.0)."""
    out = {family: 1.0}
    for fam, w in ROLE_ADJACENCY.get(family, {}).items():
        if w >= threshold:
            out[fam] = w
    return out


# ── TITLE → ROLE FAMILY classifier (rule-based, deterministic, no LLM) ───────
# Ordered, accent-insensitive keyword rules. First match wins; specific before
# generic. Returns (family, confidence). Vietnamese + English keywords.
_RULES: list[tuple[str, str]] = [
    # Manufacturing / technician (check early — "công nhân", "kỹ thuật viên")
    ("Manufacturing & Technician", r"cong nhan|cn |van hanh may|lo hoi|technician|ky thuat vien|operator|assembl|machinist|qa\b.*line|cong nhan dien"),
    # Explicit Product roles — checked BEFORE Data&AI so "AI Product Owner" /
    # "Data Product Manager" resolve to the role (Product), not the specialization.
    ("Product", r"product (owner|manager|management|lead|director|head|supervisor|executive|associate|specialist|develop)|head of product|quan ly san pham"),
    # Data & AI
    ("Data & AI", r"data scien|data engineer|machine learn|\bml\b|\bai\b|data analyst|business intelligence|analytics|data steward|big data|\bmis\b"),
    # Engineering / software
    ("Engineering", r"software|developer|\bdev\b|engineer|lap trinh|backend|frontend|full.?stack|devops|\bsre\b|\bqa\b|tester|mobile|android|ios|embedded|firmware|system|infra|cloud|\bit\b.*(engineer|developer|support|operation)|ky su(?!.*ban)"),
    # Product  (drop bare \bba\b — false-matches VN "Bà"/"Ba"; keep "business analyst")
    ("Product", r"product manage|product owner|product lead|product assistant|product specialist|business analyst|product analyst|quan ly san pham|tech product"),
    # Design
    ("Design", r"designer|\bux\b|\bui\b|graphic|creative|art director|thiet ke|motion|illustrat|copywriter|copy writer"),
    # Marketing  (drop bare \bpr\b — collides with VN; keep full comms terms)
    ("Marketing", r"marketing|\bbrand\b|growth|content|seo|digital mkt|truyen thong|thuong hieu|public relations|communicat|social|\bcrm\b|campaign|trade marketing|\bmkt\b|strategist"),
    # Sales & BD (incl. VN bank relationship-manager roles — high volume)
    ("Sales & BD", r"sales|ban hang|kinh doanh|business develop|account manager|account executive|partnership|relationship manager|\bbd\b|telesale|merchant|distribution|giam sat ban hang|khach hang ca nhan|khach hang doanh nghiep|khach hang lon|quan he khach hang|\bkhcn\b|\bkhdn\b|tu van tin dung|phat trien khach hang"),
    # Finance & Accounting (incl. credit / valuation — VN banks)
    ("Finance & Accounting", r"finance|financ|accountant|ke toan|tai chinh|audit|kiem toan|treasury|actuar|dinh phi|tax|thue|fp&a|controller|kiem soat|tham dinh (gia|tin dung)|tin dung|credit|dinh gia|thu hoi no|phan tich.*tai chinh|giao dich vien|\bgdv\b|kiem ngan|teller"),
    # HR
    ("Human Resources", r"human resource|\bhr\b|hrbp|recruit|tuyen dung|talent|nhan su|c&b|learning.*develop|\bl&d\b|dao tao|compensation|payroll"),
    # Legal / Risk / Compliance
    ("Legal, Risk & Compliance", r"legal|phap che|phap ly|compliance|tuan thu|\brisk\b|rui ro|quan tri rui ro|regulat"),
    # Customer Service
    ("Customer Service", r"customer service|customer support|cham soc khach hang|\bcskh\b|call center|contact center|dich vu khach hang|tong dai|support agent"),
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


def classify_title(title: str) -> tuple[str, float]:
    """(role_family, confidence). Falls back to General & Management @0.3."""
    n = _norm(title)
    for fam, rx in _COMPILED:
        if rx.search(n):
            return fam, 0.8
    return "General & Management", 0.3
