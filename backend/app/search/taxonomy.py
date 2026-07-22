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
    # Includes hands-on hospitality/culinary + food-tech (interim least-bad home;
    # no Hospitality/Food family exists — flagged for a future family).
    ("Manufacturing & Technician", r"cong nhan|cn |van hanh may|lo hoi|technician|ky thuat vien|operator|assembl|machinist|qa\b.*line|cong nhan dien|\bchef\b|sous chef|bep truong|housekeep|cong nghe thuc pham"),
    # Explicit Product roles — checked BEFORE Data&AI so "AI Product Owner" /
    # "Data Product Manager" resolve to the role (Product), not the specialization.
    ("Product", r"product (owner|manager|management|lead|director|head|supervisor|executive|associate|specialist|intern|develop)|head of product|quan ly san pham|phat trien san pham|truong nhom san pham|giam doc san pham|go.?to.?market|\bgtm\b"),
    # Data & AI  (business analyst lives here, NOT Product — it's analytics/
    # requirements work, adjacent to Product but a distinct, lower tier)
    ("Data & AI", r"data scien|data engineer|machine learn|\bml\b|\bai\b|data analyst|business analyst|business intelligence|analytics|data steward|big data|\bmis\b|phan tich nghiep vu|phan tich du lieu|khoa hoc du lieu|data intern|(commercial|market|insights|claim|chargeback|costing) analyst"),
    # Engineering / software (incl. semiconductor: VLSI / ASIC / IC & chip design
    # / verification / layout — checked before Design & Finance so "Analog IC
    # Design" / "Memory Controller Verification" land here, not on Design's
    # Facility / building engineering (hotel, property, plant maintenance) — a
    # DIFFERENT profession from software; "engineer" here is the building-services
    # sense (Accor "Chief Engineer", Shopee "Engineering & Maintenance"). Checked
    # BEFORE Engineering so bare "engineer" doesn't grab it as software.
    # NB: "engineer" is a generic term like "chuyên viên" — the family lives in the
    # QUALIFIER. Hardware/semiconductor "engineer" is intentionally LEFT to
    # Engineering; the software-vs-hardware split is embedding sub-family work
    # (see search-design), NOT a regex blocklist.
    ("Operations", r"facilit(y|ies)|engineering (&|and) maintenance|building services|\bhvac\b|bao tri toa nha|chief engineer|building engineer"),
    # "design" or Finance's "controller"). Bare "kỹ thuật" deliberately NOT a
    # signal: it collides with "kỹ thuật số" (digital), "kỹ thuật SEO" (mktg) and
    # maintenance/construction technicians (→ Manufacturing). The full phrase
    # "trưởng nhóm kỹ thuật" (tech lead) IS safe — lookahead keeps "…kỹ thuật số".
    ("Engineering", r"software|developer|\bdev\b|engineer|lap trinh|backend|frontend|full.?stack|devops|\bsre\b|\bqa\b|tester|mobile|android|ios|embedded|firmware|system|infra|cloud|\bit\b.*(engineer|developer|support|operation)|ky su(?!.*ban)|truong nhom ky thuat(?!\s*(so|seo|bao hanh)\b)|semiconductor|\bvlsi\b|\basic\b|\bfpga\b|\brtl\b|verilog|silicon|\bic design|chip verification|functional verification|ip verification|design verification|memory controller|\blayout\b|\bcntt\b|an toan thong tin|kiem thu|platform (specialist|manager|lead)"),
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
    ("Legal, Risk & Compliance", r"legal|phap che|phap ly|compliance|tuan thu|\brisk\b|rui ro|quan tri rui ro|regulat|aml|phong chong rua tien|thanh tra|nghiem thu|gian lan|an ninh"),
    # Sales & BD (incl. VN bank relationship-manager roles — high volume)
    ("Sales & BD", r"sales|\bsale\b|ban hang|kinh doanh|business develop|account manager|account executive|partnership|relationship manager|\bbd\b|telesale|merchant|distribution|giam sat ban hang|khach hang ca nhan|khach hang doanh nghiep|khach hang lon|quan he khach hang|\bkhcn\b|\bkhdn\b|tu van tin dung|phat trien khach hang|account specialist|account associate|client partner|client solution|priority relationship|phat trien thi truong|phat trien doi tac"),
    # Finance & Accounting (incl. credit / valuation — VN banks)
    ("Finance & Accounting", r"finance|financ|accountant|accounting|ke toan|tai chinh|audit|kiem toan|treasury|actuar|dinh phi|tax|thue|fp&a|controller|kiem soat|tham dinh (gia|tin dung)|tin dung|credit|dinh gia|thu hoi no|phan tich.*tai chinh|giao dich vien|\bgdv\b|kiem ngan|teller|valuation|modeling|economics|\bvme\b|card portfolio|\bavp\b|cash management|du toan|ngan sach|\btham dinh\b|xu ly no"),
    # HR
    ("Human Resources", r"human resource|\bhr\b|hrbp|recruit|tuyen dung|talent|nhan su|c&b|learning.*develop|\bl&d\b|dao tao|compensation|payroll|employer brand|nhan tai|nang luc|quan he lao dong|dai ngo"),
    # Customer Service (incl. Customer Success / Experience)
    ("Customer Service", r"customer (service|support|success|experience)|cham soc khach hang|\bcskh\b|call center|contact center|dich vu khach hang|tong dai|support agent|customer success|phuc vu|le tan|receptionist"),
    # Operations / supply chain / commerce ops
    # Operations incl. supply chain + import/export / customs / freight. XNK and
    # hải quan had NO rule before → they fell to the General & Management catch-all
    # (so "Chuyên viên Xuất nhập khẩu" mis-matched strategy/consultant roles).
    # Regulatory-customs ("Customs Regulatory") still resolves to Legal/Risk first
    # (checked earlier); "Export Sales"/"Kinh doanh XNK" still resolve to Sales.
    ("Operations", r"operation|van hanh|supply chain|chuoi cung ung|logistic|warehouse|fulfil|category|seller|merchandis|procure|mua hang|thu mua|planning|planner|inventory|dieu phoi|giao nhan|vendor|optimization|xuat nhap khau|\bxnk\b|hai quan|customs|\bimport\b|\bexport\b|freight|forwarding|lay hang|xu ly tai buu cuc|picking|hanh chinh|van phong|thu ky|van thu|sourcing|supplier|buyer|purchasing|xay dung|giao thong|ket cau|kien truc su"
     # \bkho\b (warehouse) not bare "kho" — _norm folds "khoa"/"khóa" → "khoa" ⊃
     # "kho", which wrongly pulled bác sĩ đa khoa / trưởng khoa / khóa học into
     # Operations. Word-bounded still matches "kho vận", "nhân viên kho".
     r"|\bkho\b"),
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


# A LEADING hiring verb is a recruitment AD, not a recruiter role: the real
# role is what follows. "TUYỂN DỤNG Dược sĩ" is a pharmacist job, not HR;
# "Nhân viên Tuyển dụng" (verb NOT leading) IS a recruiter role — left intact.
# Strips an optional [TAG] then the leading verb, so classification sees the role.
_HIRING_PREFIX = re.compile(r'^\s*(?:\[[^\]]*\]\s*)?(?:tuyen dung|tuyen gap|can tuyen|now hiring|hiring)\s+')


def classify_title(title: str) -> tuple[str, float]:
    """(role_family, confidence). Falls back to General & Management @0.3."""
    n = _HIRING_PREFIX.sub("", _norm(title))
    for fam, rx in _COMPILED:
        if rx.search(n):
            return fam, FULL_CONFIDENCE
    return "General & Management", FALLBACK_CONFIDENCE


# ── SENIORITY (ordered low → high) ───────────────────────────────────────────
# A separate axis from role family: a "Product Manager" and a "Product Intern"
# share a family but not a level. Used to demote jobs BELOW the candidate's
# level (an intern role for a mid/senior candidate).
SENIORITY_LEVELS = (
    "Intern", "Fresher", "Junior", "Mid", "Senior", "Lead/Manager", "Director/Head+",
)
_LEVEL_INDEX = {lv: i for i, lv in enumerate(SENIORITY_LEVELS)}

# Title → seniority keyword rules (specific → generic, first match wins).
# Bare "manager" is INTENTIONALLY not a signal: a "Product Manager" is a mid IC
# role, not Lead — only explicit lead/principal/head/senior/junior/intern words
# move the level. Titles with no signal return None (→ no seniority penalty).
_SENIORITY_RULES: list[tuple[str, str]] = [
    # Intern = student/temporary (internship, thực tập sinh, sinh viên); Fresher =
    # graduate entry (fresher, "tập sự" — VN banks' fresh-grad probation track like
    # "Chuyên viên Tập sự" / "Lãnh đạo Tập sự / Management Associate"). Two bands:
    # a Fresher sits ABOVE an Intern, both below Junior.
    ("Intern",   r"\bintern(ship)?\b|thuc tap|sinh vien|\btts\b"),
    ("Fresher",  r"fresher|tap su"),
    ("Director/Head+", r"director|head of|\bhead\b|chief|\bc[efimot]o\b|\bvp\b|svp|evp|vice president|giam doc|truong phong|truong ban|truong bo phan|pho phong"),
    # Mid-management band: leader/supervisor/giám sát/trưởng nhóm/trưởng ca/deputy
    # are genuine Lead/Manager roles in the VN market. (Bare "manager"/"quản lý"
    # stay OFF — a "Product Manager"/"Quản lý sản phẩm" is a mid IC — but "Deputy
    # Manager" / "Trưởng ca" carry the signal.)
    ("Lead/Manager",   r"\blead\b|leader|principal|\bstaff\b|supervisor|giam sat|truong nhom|truong ca|\bdeputy\b"),
    # cvcc/cvc = chuyên viên cao cấp / chuyên viên chính (VN senior-IC grades);
    # bare "cv" (chuyên viên) is a generic grade, intentionally NOT a signal. Both
    # the ABBREV (cvc/cvcc) and the SPELLED-OUT form ("chuyên viên chính"/"…cao
    # cấp") count — the spelled-out "chính" was previously missed. Runs before the
    # generic-officer fallback below so a "Chuyên viên chính …" resolves here.
    ("Senior",         r"\bsenior\b|\bsr\b|cao cap|cap cao|chuyen gia|chuyen vien cao cap|chuyen vien chinh|\bcvcc\b|\bcvc\b"),
    ("Junior",         r"\bjunior\b|\bjr\b|entry[ -]?level|moi ra truong"),
    # Domain/engagement fallbacks (LAST, lowest priority): a bare role carries no
    # level word but its segment implies a level in the VN market. Placed after
    # every explicit-level rule so those still win ("CVCC KHCN"→Senior, "Tập sự
    # KHCN"→Fresher, "Giám đốc KHDN"→Director).
    #   CTV (cộng tác viên) = collaborator/part-time/freelance = entry (Fresher).
    #     First here so a "Tư vấn viên (CTV Inbound)" reads as the CTV engagement.
    #   Tư vấn viên / giao dịch viên (teller) = entry front-line IC (Junior).
    #   Khách hàng Cá nhân (retail RM) = Junior, Khách hàng Doanh nghiệp (corp RM) = Mid.
    ("Fresher",        r"cong tac vien|\bctv\b"),
    ("Junior",         r"tu van vien|giao dich vien"),
    ("Mid",            r"khach hang doanh nghiep|\bkhdn\b"),
    ("Junior",         r"khach hang ca nhan|\bkhcn\b"),
]
_SENIORITY_COMPILED = [(lv, re.compile(rx, re.I)) for lv, rx in _SENIORITY_RULES]


# ── Description-derived seniority (fallback when the TITLE has no level word) ──
# Titles alone classify <50% of VN postings — "Nhân viên kinh doanh", "Chuyên
# viên …" carry no level token. The description sometimes states the level, but
# it's a NOISY, often-incompletely-scraped field, so this path is precision-
# first: a wrong band is worse than None. Two tiers:
#   1) an explicitly LABELED level field ("Cấp bậc: Senior") is trusted;
#   2) a loose mention counts only when it sits next to a self-referential cue
#      (vị trí / ứng viên / yêu cầu…) AND not in a context that points at ANOTHER
#      role — a reporting line ("báo cáo cho Senior Manager"), a mentor ("hỗ trợ
#      Senior"), or an advancement path ("thăng tiến lên Senior").
_SEN_LABEL_RE = re.compile(
    r"(?:cap bac|cap do|chuc danh|chuc vu|trinh do|vi tri|level|seniority|position|rank)"
    r"\s*[:\-]\s*([^\n.;|]{0,40})"
)
# Self-referential cues: the level word is describing THIS posting.
_SEN_POS_CTX_RE = re.compile(
    r"vi tri|ung vien|yeu cau|can tuyen|tuyen dung|cap bac|kinh nghiem|uu tien|trinh do|level|position"
)
# The level word describes a DIFFERENT role (reporting line / mentor / team) or a
# future aspiration, not the posting's own level → reject.
_SEN_NEG_CTX_RE = re.compile(
    r"bao cao|report(?:ing)? to|truc thuoc|duoi (?:su )?quyen|duoi su quan ly|"
    r"ho tro|phoi hop|lam viec (?:voi|cung)|hop tac|tro ly|assistant to|thanh vien|"
    r"thuoc (?:nhom|team|phong|bo phan)|cung cac|thang tien|tro thanh|len vi tri|"
    r"len chuc|len cap|phat trien len"
)
_SEN_CTX_WINDOW = 30


def _seniority_from_desc(description: str) -> str | None:
    n = _norm(description)
    # 1) An explicitly labeled level field wins (unless the value itself points
    #    at another role, e.g. "Vị trí: hỗ trợ Senior Manager").
    for m in _SEN_LABEL_RE.finditer(n):
        val = m.group(1)
        if _SEN_NEG_CTX_RE.search(val):
            continue
        for lv, rx in _SENIORITY_COMPILED:
            if rx.search(val):
                return lv
    # 2) Loose mention — first (highest-priority) rule with a match that has a
    #    self-referential cue nearby and no "another role / aspiration" cue.
    for lv, rx in _SENIORITY_COMPILED:
        for mm in rx.finditer(n):
            win = n[max(0, mm.start() - _SEN_CTX_WINDOW):mm.end() + _SEN_CTX_WINDOW]
            if _SEN_NEG_CTX_RE.search(win):
                continue
            if _SEN_POS_CTX_RE.search(win):
                return lv
    return None


# ── Generic "Chuyên viên" (officer IC) evidence scorer ───────────────────────
# A bare "Chuyên viên X" with no grade word is base-undetermined: the same title
# is Junior at one firm and Mid at a bank (hierarchy Nhân viên→Chuyên viên→Chuyên
# viên chính). Rather than HARD-LABEL by domain keyword, we weigh EVIDENCE in
# priority order — explicit entry cue → required years → work-scope cues — and use
# a soft domain prior only as a tie-breaker. When nothing is decisive we return
# None: a controlled UNKNOWN beats a plausible-but-wrong Junior.
_OFFICER_ENTRY_RE = re.compile(          # explicit "no experience" / new-grad → Junior
    r"khong yeu cau kinh nghiem|khong can kinh nghiem|chua co kinh nghiem|"
    r"khong yeu cau kn|chua yeu cau kinh nghiem|sinh vien moi ra truong|"
    r"moi tot nghiep|moi ra truong")
_OFFICER_JR_SCOPE = re.compile(          # execution / front-line / support
    r"ho tro|nhap lieu|theo doi|cap nhat|goi dien|telesale|tim kiem khach hang|"
    r"chot sale|chot don|cham soc khach hang|dich vu khach hang|hanh chinh|"
    r"le tan|tong dai|xu ly ho so|xu ly giao dich|dieu phoi|thu hoi no|thu ngan")
_OFFICER_MID_SCOPE = re.compile(         # analysis / ownership / cross-functional
    r"phan tich|kiem soat|kiem toan|quan tri rui ro|\brui ro\b|giai phap|"
    r"quan ly du an|quan ly chi phi|quan ly hop dong|quan ly du lieu|"
    r"khai thac tai san|quan ly tai san|ke toan tong hop|nghien cuu thi truong|"
    r"xay dung quy trinh|xay dung khung|business case|go to market|"
    r"phat trien kenh|phat trien doi tac|dam phan hop dong|phoi hop lien|chu tri")
_OFFICER_SR_SCOPE = re.compile(          # strategy / lead / approve
    r"chien luoc|dan dat|mentoring|phe duyet|dinh huong chien luoc")
# Soft domain priors (tie-breaker ONLY). Ambiguous domains (BD, HR, design,
# training, generic operations) are deliberately absent → they stay UNKNOWN.
_OFFICER_JR_PRIOR = re.compile(
    r"kinh doanh|tu van|dich vu|cham soc|ho tro|tuyen dung|hanh chinh|dieu phoi|thu hoi")
_OFFICER_MID_PRIOR = re.compile(
    r"phan tich|kiem soat|quan tri|giai phap|ke toan|khai thac")
# Genuinely ambiguous domains — level swings on scope, not the word. If no
# entry/years/scope evidence lifted them, DON'T fall through to a domain prior
# (e.g. "Phát triển Kinh doanh" contains "kinh doanh" but BD ≠ front-line sales):
# leave UNKNOWN. Checked AFTER scope so "Phát triển kênh/đối tác" (a Mid scope
# cue) still resolves to Mid.
_OFFICER_AMBIG = re.compile(r"phat trien|thiet ke|dao tao|nhan su|hrbp|van hanh")


def _req_years(title: str, description: str | None) -> int | None:
    """Explicit years-of-experience the posting asks for (title+description), or
    None. Reuses the facet extractor (context-guarded); lazy import breaks the
    taxonomy↔facet cycle."""
    from app.search.facet import _required_years
    return _required_years({"title": title, "description": description or ""})


def _years_band(yrs: int | None) -> str | None:
    """Experience requirement → seniority band: ≤1 yr Junior, 2–4 Mid, 5+ Senior.
    None when no positive year count (0/unstated carries no signal here)."""
    if not yrs:
        return None
    return "Junior" if yrs <= 1 else "Mid" if yrs <= 4 else "Senior"


def _officer_level(title: str, description: str | None) -> str | None:
    """Junior/Mid/Senior for a generic 'Chuyên viên X' by evidence, else None
    (UNKNOWN). Priority: explicit entry cue → required years → work-scope cues →
    soft domain prior. Domain is only a tie-breaker so no label is manufactured
    from a keyword alone."""
    n = _norm(title)
    text = _norm(f"{title} \n {description or ''}")
    if _OFFICER_ENTRY_RE.search(text):
        return "Junior"
    yb = _years_band(_req_years(title, description))
    if yb:
        return yb
    sr = len(_OFFICER_SR_SCOPE.findall(text))
    md = len(_OFFICER_MID_SCOPE.findall(text))
    jr = len(_OFFICER_JR_SCOPE.findall(text))
    if sr and sr >= md and sr >= jr:
        return "Senior"
    if md > jr:
        return "Mid"
    if jr > md:
        return "Junior"
    if _OFFICER_AMBIG.search(n):   # scope-dependent domain, no evidence → UNKNOWN
        return None
    mid_p, jr_p = _OFFICER_MID_PRIOR.search(n), _OFFICER_JR_PRIOR.search(n)
    if mid_p and not jr_p:
        return "Mid"
    if jr_p and not mid_p:
        return "Junior"
    return None  # controlled UNKNOWN — leave NULL rather than guess


def classify_seniority(title: str, description: str | None = None) -> str | None:
    """Seniority label for a posting, or None when it carries no signal.

    The TITLE is the primary, highest-precision signal (unchanged). Only when the
    title has no level word do we consult the DESCRIPTION — guarded, because that
    field is noisy and often incompletely scraped, so a wrong label is worse than
    None (see _seniority_from_desc). A missing/empty description yields the same
    None as before → no regression for postings we can't read."""
    n = _norm(title)
    # 1. Explicit TITLE level word — primary, highest precision.
    for lv, rx in _SENIORITY_COMPILED:
        if rx.search(n):
            return lv
    # 2. Explicit DESCRIPTION label ("Cấp bậc: X" / guarded self-ref mention) — a
    #    stated level outranks any inference below (see _seniority_from_desc).
    if description:
        d = _seniority_from_desc(description)
        if d:
            return d
    # 3. Generic "Chuyên viên X" with no grade word: evidence, not domain
    #    (entry cue → years → work-scope → soft domain prior).
    if "chuyen vien" in n:
        lv = _officer_level(title, description)
        if lv:
            return lv
    # 4. Any role with an explicit years-of-experience requirement → band. A
    #    strong signal for titles that carry no level word (nhân viên, kỹ sư, …).
    return _years_band(_req_years(title, description))


def level_index(level: str) -> int | None:
    """Ordinal position of a seniority label (0 = Intern), or None if unknown."""
    return _LEVEL_INDEX.get(level)


# Loose level strings (CV-extractor "current_level", API callers) → canonical
# SENIORITY_LEVELS. Lets the seniority signal engage even when the input isn't
# already vocab-exact ("Lead", "Mid-level", "thực tập" → canonical).
_LEVEL_ALIASES: list[tuple[str, str]] = [
    (r"intern|thuc tap|sinh vien", "Intern"),
    (r"fresher|tap su", "Fresher"),
    (r"director|head|chief|\bc[efimot]o\b|\bvp\b|svp|evp|giam doc|truong phong", "Director/Head+"),
    (r"lead|principal|manager|\bstaff\b|quan ly|truong nhom", "Lead/Manager"),
    (r"senior|\bsr\b|cao cap", "Senior"),
    (r"junior|\bjr\b|entry|moi ra truong", "Junior"),
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
