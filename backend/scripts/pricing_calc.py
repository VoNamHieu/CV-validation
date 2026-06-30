#!/usr/bin/env python3
"""Pricing calculator — chi phí gọi Gemini mỗi action → đối chiếu giá credit.

Mục tiêu: biết MỖI action tốn bao nhiêu TIỀN THẬT (USD/VND) để đặt giá credit
cho đúng (không lỗ). Có 2 đầu vào bạn PHẢI điền số thật:

  1) PRICES — giá token Gemini-3 (USD / 1 triệu token), lấy từ trang pricing
     Google AI / hoá đơn của bạn. (Đừng tin số mặc định bên dưới — là GIẢ ĐỊNH
     để minh hoạ công thức.)
  2) TOKENS — số token in/out/think mỗi action. Số mặc định là ƯỚC LƯỢNG; thay
     bằng số ĐO THẬT từ log `[tag] tokens=...` (đã bật trong gemini.ts) cho chuẩn.

Chạy:  python3 backend/scripts/pricing_calc.py
"""

# ── (1) GIÁ TOKEN GEMINI — USD / 1,000,000 token. ⚠️ ĐIỀN SỐ THẬT ──
# Thinking token thường tính giá như OUTPUT token (đặt think = out nếu vậy).
PRICES = {
    # gemini-3.1-pro-preview  (reasoning: score / optimize / gap_report)
    "pro":   {"in": 1.25, "out": 10.00, "think": 10.00},   # GIẢ ĐỊNH — thay số thật
    # gemini-3-flash-preview  (light: parse/extract/rank/map…)
    "flash": {"in": 0.10, "out": 0.40,  "think": 0.40},    # GIẢ ĐỊNH — thay số thật
}

USD_VND = 25_400          # tỉ giá USD→VND (cập nhật khi cần)

# ── (2) TOKEN mỗi action. [M] = ĐO THẬT (measure-tokens.mts, CV/JD mẫu nhỏ —
# input thực tế của user lớn hơn, scale lên ~1.5-3×). [E] = ước lượng.
# credits = giá credit hiện tại trong backend COSTS (app/routers/credits.py).
ACTIONS = {
    "parse_pdf":         {"tier": "flash", "in": 3000, "out": 2000, "think": 0,    "credits": 1},  # [E]
    "extract_cv":        {"tier": "flash", "in": 2500, "out": 1800, "think": 0,    "credits": 1},  # [E]
    "extract_jd":        {"tier": "flash", "in": 474,  "out": 111,  "think": 0,    "credits": 1},  # [M]
    "search_profile":    {"tier": "flash", "in": 2500, "out": 400,  "think": 0,    "credits": 1},  # [E]
    "smart_search":      {"tier": "flash", "in": 2000, "out": 600,  "think": 0,    "credits": 1},  # [E]
    "rank_jobs":         {"tier": "flash", "in": 4000, "out": 800,  "think": 0,    "credits": 1},  # [E]
    "extract_job_links": {"tier": "flash", "in": 3000, "out": 800,  "think": 0,    "credits": 1},  # [E]
    "map_form":          {"tier": "flash", "in": 2000, "out": 1000, "think": 0,    "credits": 1},  # [E]
    "agent_plan":        {"tier": "flash", "in": 2500, "out": 1200, "think": 0,    "credits": 1},  # [E]
    "score":             {"tier": "pro",   "in": 1041, "out": 659,  "think": 1839, "credits": 4},  # [M]
    "optimize":          {"tier": "pro",   "in": 2160, "out": 769,  "think": 2306, "credits": 5},  # [M] × variant
    "gap_report":        {"tier": "pro",   "in": 1756, "out": 920,  "think": 1265, "credits": 5},  # [M] (đo trên Flash)
}

# ── Giá bán credit hiện tại (frontend/src/lib/payment.ts TOPUP_PACK) ──
PACK_CREDITS = 50
PACK_PRICE_VND = 50_000

# Một flow "tối ưu 1 job" điển hình (để tính chi phí/đơn). Chỉnh theo pipeline.
TYPICAL_JOB = ["score", "optimize"]   # + parse_pdf 1 lần khi upload CV


def cost_usd(a: dict) -> float:
    p = PRICES[a["tier"]]
    return (a["in"] * p["in"] + a["out"] * p["out"] + a["think"] * p["think"]) / 1_000_000


def main() -> None:
    revenue_per_credit_vnd = PACK_PRICE_VND / PACK_CREDITS
    revenue_per_credit_usd = revenue_per_credit_vnd / USD_VND

    print("⚠️  Giá token bên dưới là GIẢ ĐỊNH — thay PRICES bằng số thật của bạn.\n")
    print(f"{'action':18} {'tier':6} {'tokens(i/o/t)':18} {'$ / lần':>10} {'₫ / lần':>10} "
          f"{'credits':>8} {'$/credit':>9}")
    print("-" * 92)
    worst = 0.0
    for name, a in ACTIONS.items():
        c_usd = cost_usd(a)
        c_vnd = c_usd * USD_VND
        per_credit = c_usd / a["credits"] if a["credits"] else 0
        worst = max(worst, per_credit)
        toks = f"{a['in']}/{a['out']}/{a['think']}"
        print(f"{name:18} {a['tier']:6} {toks:18} {c_usd:>10.5f} {c_vnd:>10.1f} "
              f"{a['credits']:>8} {per_credit:>9.5f}")

    print("-" * 92)
    job_usd = sum(cost_usd(ACTIONS[x]) for x in TYPICAL_JOB)
    job_credits = sum(ACTIONS[x]["credits"] for x in TYPICAL_JOB)
    print(f"\nFlow 'tối ưu 1 job' ({'+'.join(TYPICAL_JOB)}): "
          f"≈ ${job_usd:.4f}  ({job_usd*USD_VND:,.0f}₫)  ·  {job_credits} credit")

    print("\n── Kinh tế credit ──")
    print(f"  Giá bán: {PACK_CREDITS} credit = {PACK_PRICE_VND:,}₫ "
          f"→ doanh thu/credit = {revenue_per_credit_vnd:,.0f}₫ (${revenue_per_credit_usd:.5f})")
    print(f"  Chi phí cao nhất / credit (action đắt nhất): ${worst:.5f} "
          f"({worst*USD_VND:,.1f}₫)")
    margin = revenue_per_credit_usd - worst
    ratio = (revenue_per_credit_usd / worst) if worst else float('inf')
    verdict = "LỜI ✅" if margin > 0 else "LỖ ❌"
    print(f"  Biên/credit (worst case): ${margin:.5f}  → {verdict}  (bán/giá vốn ≈ {ratio:.1f}×)")
    # Break-even: giá bán tối thiểu / credit để hoà vốn ở action đắt nhất
    print(f"  Giá hoà vốn tối thiểu/credit: {worst*USD_VND:,.1f}₫  "
          f"(đang bán {revenue_per_credit_vnd:,.0f}₫)")


if __name__ == "__main__":
    main()
