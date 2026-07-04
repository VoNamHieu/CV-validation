"""Company → Industry mapping (facet vocab, layer 1).

Hand-curated by hiring-behavior (not abstract sector): e-commerce marketplaces
are split from SaaS, consumer-finance from retail banking, etc. Keyed by the
exact `name` in featured_companies. classify_company() falls back to keyword
rules for anything unmapped, then "Conglomerate / Other".
"""
from __future__ import annotations

import re
from app.search.taxonomy import INDUSTRIES  # noqa: F401  (validity reference)

COMPANY_INDUSTRY: dict[str, str] = {
    # E-commerce & Marketplace
    "Shopee": "E-commerce & Marketplace", "Lazada": "E-commerce & Marketplace",
    "Tiki": "E-commerce & Marketplace", "TikTok": "E-commerce & Marketplace",
    "ByteDance": "E-commerce & Marketplace", "Sendo": "E-commerce & Marketplace",
    "Amazon": "E-commerce & Marketplace",

    # Technology Platform / SaaS
    "VNG": "Technology Platform / SaaS", "Grab": "Technology Platform / SaaS",
    "Be": "Technology Platform / SaaS", "Sea": "Technology Platform / SaaS",
    "Agoda": "Technology Platform / SaaS", "Traveloka": "Technology Platform / SaaS",
    "Klook": "Technology Platform / SaaS", "KiotViet": "Technology Platform / SaaS",
    "OpenCommerce Group": "Technology Platform / SaaS", "Trusting Social": "Technology Platform / SaaS",
    "UrBox": "Technology Platform / SaaS", "One Mount Group": "Technology Platform / SaaS",
    "Base Inc": "Technology Platform / SaaS",
    "Oracle": "Technology Platform / SaaS", "Microsoft": "Technology Platform / SaaS",
    "Google": "Technology Platform / SaaS", "IBM": "Technology Platform / SaaS",
    "SAP": "Technology Platform / SaaS", "Salesforce": "Technology Platform / SaaS",
    "ServiceNow": "Technology Platform / SaaS", "Atlassian": "Technology Platform / SaaS",

    # Fintech & Payments
    "MoMo": "Fintech & Payments", "VNPAY": "Fintech & Payments", "Cake": "Fintech & Payments",
    "Visa": "Fintech & Payments", "Mastercard": "Fintech & Payments",
    "FE Credit": "Fintech & Payments", "F88": "Fintech & Payments",

    # IT Services / Outsourcing
    "FPT Software": "IT Services / Outsourcing", "FPT IS": "IT Services / Outsourcing",
    "Viettel Software": "IT Services / Outsourcing", "Viettel AI": "IT Services / Outsourcing",
    "Viettel High Tech": "IT Services / Outsourcing", "NashTech": "IT Services / Outsourcing",
    "KMS Technology": "IT Services / Outsourcing", "Cốc Cốc": "IT Services / Outsourcing",
    "Axon Active": "IT Services / Outsourcing", "TMA Solutions": "IT Services / Outsourcing",
    "Rikkeisoft": "IT Services / Outsourcing", "CMC Global": "IT Services / Outsourcing",

    # Banking
    "Vietcombank": "Banking", "BIDV": "Banking", "VietinBank": "Banking", "Agribank": "Banking",
    "SHB": "Banking", "SeABank": "Banking", "OCB": "Banking", "Eximbank": "Banking",
    "Techcombank": "Banking", "MB Bank": "Banking", "VPBank": "Banking", "TPBank": "Banking",
    "ACB": "Banking", "HDBank": "Banking", "Sacombank": "Banking", "MSB": "Banking",
    "VIB": "Banking", "GPBank": "Banking",
    "DBS": "Banking", "HSBC": "Banking", "Standard Chartered": "Banking", "Citi": "Banking",
    "NAB Vietnam": "Banking",

    # Securities & Investment
    "FPT Securities": "Securities & Investment", "TCBS": "Securities & Investment",
    "VCBS": "Securities & Investment", "VPBank Securities": "Securities & Investment",
    "VPS": "Securities & Investment",

    # Insurance
    "Sun Life Vietnam": "Insurance", "Manulife": "Insurance", "AIA": "Insurance",
    "Prudential": "Insurance", "Chubb": "Insurance", "Bảo Việt": "Insurance",

    # FMCG & Consumer Goods
    "Vinamilk": "FMCG & Consumer Goods", "Heineken Vietnam": "FMCG & Consumer Goods",
    "Nestlé Vietnam": "FMCG & Consumer Goods", "Coca-Cola": "FMCG & Consumer Goods",
    "PepsiCo": "FMCG & Consumer Goods", "Ajinomoto Vietnam": "FMCG & Consumer Goods",
    "Acecook Vietnam": "FMCG & Consumer Goods", "Suntory PepsiCo Vietnam": "FMCG & Consumer Goods",
    "TH Group": "FMCG & Consumer Goods", "Mondelez Kinh Do": "FMCG & Consumer Goods",
    "Orion Vietnam": "FMCG & Consumer Goods", "Vinasoy": "FMCG & Consumer Goods",
    "Unilever Vietnam": "FMCG & Consumer Goods", "P&G Vietnam": "FMCG & Consumer Goods",
    "Masan Group": "FMCG & Consumer Goods", "JTI": "FMCG & Consumer Goods", "BAT": "FMCG & Consumer Goods",

    # Retail
    "Central Retail": "Retail", "FPT Shop": "Retail", "Decathlon": "Retail", "Adidas": "Retail",
    "Nike": "Retail", "Thế Giới Di Động": "Retail", "PNJ": "Retail", "WinMart": "Retail",
    "Highlands Coffee": "Retail", "Pharmacity": "Retail", "Guardian": "Retail",
    "Sunhouse": "Retail", "Golden Gate Group": "Retail",

    # Logistics & Delivery
    "Hop Nhat Logistics": "Logistics & Delivery", "247Express": "Logistics & Delivery",
    "GHN": "Logistics & Delivery", "GHTK": "Logistics & Delivery", "Ninja Van": "Logistics & Delivery",
    "Ahamove": "Logistics & Delivery", "Avina Logistics": "Logistics & Delivery",
    "DHL": "Logistics & Delivery", "FedEx": "Logistics & Delivery", "UPS": "Logistics & Delivery",
    "Kuehne+Nagel": "Logistics & Delivery", "Nippon Express": "Logistics & Delivery",
    "DSV": "Logistics & Delivery", "Hellmann": "Logistics & Delivery",
    "Viettel Post": "Logistics & Delivery", "Gemadept": "Logistics & Delivery",
    "Bee Logistics": "Logistics & Delivery", "Maersk": "Logistics & Delivery",

    # Manufacturing & Semiconductor
    "Renesas": "Manufacturing & Semiconductor", "Marvell": "Manufacturing & Semiconductor",
    "Infineon": "Manufacturing & Semiconductor", "NVIDIA": "Manufacturing & Semiconductor",
    "Qualcomm": "Manufacturing & Semiconductor", "Samsung": "Manufacturing & Semiconductor",
    "LG": "Manufacturing & Semiconductor", "Canon": "Manufacturing & Semiconductor",
    "Hitachi": "Manufacturing & Semiconductor", "Sony": "Manufacturing & Semiconductor",
    "Bosch": "Manufacturing & Semiconductor",

    # Industrial / Energy / Auto
    "Air Liquide": "Industrial / Energy / Auto", "Siemens": "Industrial / Energy / Auto",
    "Schneider Electric": "Industrial / Energy / Auto", "ABB": "Industrial / Energy / Auto",
    "GE Vernova": "Industrial / Energy / Auto", "3M": "Industrial / Energy / Auto",
    "Hoa Sen Group": "Industrial / Energy / Auto", "VinFast": "Industrial / Energy / Auto",

    # Pharma & Healthcare
    "Vinmec": "Pharma & Healthcare",

    # Consulting & Professional
    "McKinsey": "Consulting & Professional", "Deloitte": "Consulting & Professional",
    "PwC": "Consulting & Professional", "EY": "Consulting & Professional",
    "KPMG": "Consulting & Professional", "Accenture": "Consulting & Professional",

    # Agency / Media / Marketing
    "Ogilvy": "Agency / Media / Marketing", "Dentsu": "Agency / Media / Marketing",
    "CleverAds": "Agency / Media / Marketing", "SEONGON": "Agency / Media / Marketing",
    "Vietcetera": "Agency / Media / Marketing",

    # Hospitality & Travel
    "Marriott": "Hospitality & Travel", "Hilton": "Hospitality & Travel",
    "Hyatt": "Hospitality & Travel", "Accor": "Hospitality & Travel",
    "IHG": "Hospitality & Travel", "Vinpearl": "Hospitality & Travel",

    # Education
    "Apollo English": "Education", "Vinschool": "Education",

    # Conglomerate / Other
    "Vingroup": "Conglomerate / Other", "Vinhomes": "Conglomerate / Other",
}

# keyword fallback on name/url for anything not explicitly mapped. Keywords are
# WORD-BOUNDED so a substring can't hijack a name — bare "shop" used to fold
# "Shopee" into Retail; \bshop\b only matches a standalone "shop"/"X Shop".
_KW = [
    ("Banking", r"\bbank\b|ngan hang"),
    ("Securities & Investment", r"securit|chung khoan|\bvcbs\b|\btcbs\b"),
    ("Insurance", r"insur|bao hiem|\blife\b"),
    ("Logistics & Delivery", r"logistic|express|delivery|giao hang|cargo|freight|\bpost\b|van tai"),
    ("IT Services / Outsourcing", r"software|technolog|solutions|\bit\b|digital"),
    ("Retail", r"\bretail\b|\bshop\b|\bstore\b|\bmart\b"),
    ("Education", r"\bedu\b|english|academy|school|university"),
]

# Legal forms + country tags stripped when normalizing a company name for lookup,
# so "Shopee Vietnam", "FE Credit JSC" match their bare dict key.
_LEGAL = re.compile(
    r"\b(vietnam|viet nam|vn|jsc|ltd|limited|co|corp|corporation|company|group|"
    r"holdings?|inc|plc|pte|llc)\b", re.I)


def _norm_name(s: str) -> str:
    s = _LEGAL.sub(" ", (s or "").lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# Precomputed once: normalized dict key → industry (for the normalized-exact pass).
_NORM_KEYS = {_norm_name(k): v for k, v in COMPANY_INDUSTRY.items()}


def classify_company(name: str, url: str = "") -> str:
    # 1. exact key
    if name in COMPANY_INDUSTRY:
        return COMPANY_INDUSTRY[name]
    nn = _norm_name(name)
    # 2. normalized-exact ("Shopee Vietnam" → "shopee")
    if nn and nn in _NORM_KEYS:
        return _NORM_KEYS[nn]
    # 3. whole-word key containment ("TikTok Shop" contains the "tiktok" key).
    #    Match single-token keys as a whole token; multi-word keys as a phrase —
    #    so a short key ("sea") can't hit a longer word ("seabank").
    toks = set(nn.split())
    for k, ind in COMPANY_INDUSTRY.items():
        kn = _norm_name(k)
        if not kn:
            continue
        if (" " in kn and kn in nn) or (" " not in kn and kn in toks):
            return ind
    # 4. word-bounded keyword fallback
    blob = f"{name} {url}".lower()
    for ind, rx in _KW:
        if re.search(rx, blob):
            return ind
    return "Conglomerate / Other"
