# Sổ thí nghiệm — search engine tuning

Mỗi dòng = một `score` sau một patch. Không có số ở đây = chưa xảy ra.
Nhãn: v2 (Intent×Reach, min), IDCG chung per-profile, pool 2026-07-14, 40 profile.

| # | ngày | patch | facet | +rerank | Δrerank | vs baseline (facet) | coverage | verdict | commit |
|---|------|-------|------:|--------:|--------:|--------------------:|:--------:|---------|--------|
| 0 | 07-15 | **BASELINE** (patch 15/07: VN titles + domain alias) | 0.696 | 0.863 | +0.167 | — | 0 | — | (uncommitted) |
| A1 | 07-15 | lookahead `bao hanh` (warranty ≠ Engineering) | 0.696 | 0.864 | +0.168 | +0.000 | 0 | ACCEPT (correctness; neutral on agg, swe-tech-lead rerank 0.933→0.962) | (pending) |

| A2 | 07-15 | garbage filter (DB path + skip-to-main-content) + strip hiring-verb prefix trước classify | 0.709 | 0.864 | +0.156 | +0.013 | 0 | ACCEPT (6 profile mục tiêu ↑ 0.06–0.15, 0 regression; correctness) | (pending) |

**Ghi chú A1**: +1 nhãn mới (Infineon Digital Verification cho swe-tech-lead) chấm INLINE bởi main agent (không mù với score) — intent=2/reach=1/grade=1. Ảnh hưởng: 1 dòng, rerank #9. Đã đóng coverage về 0.

**Ghi chú A2**: gỡ grade-0 pollution (2 keyword-trap "TUYỂN DỤNG X" khỏi 4 profile HR + "Skip to main content" khỏi 2 profile mkt/sales). +8 nhãn mới (HR/recruiter thật trồi lên thay trap) chấm bởi 1 judge agent MÙ, 2 chiều. Facet gain khu trú đúng profile bị bẩn; hr-recruiter vẫn 0.378 (thấp) vì còn lỗi bare `engineer`/khác — để Phase B. Lưu ý: aggregate +0.013 đo trên label set +8 (drift nhẹ), bằng chứng chính = per-profile ↑ đồng hướng.

| B1 | 07-15 | facility-engineer → Operations (positive-routing, TRƯỚC Engineering) | 0.710 | 0.864 | +0.154 | +0.014 | 0 | ACCEPT (swe-backend 0.234→0.276; correctness, 0 regression) | (pending) |

**Ghi chú B1**: chỉ demote facility/building/HVAC/chief-engineer (Accor, Shopee). Semiconductor/FPGA/hardware-validation/SRE **cố ý giữ Engineering** — quyết định của user. +3 nhãn (2 job software thật TPBank/FPT trồi lên = grade 2, 1 Bosch Facility Intern → Ops). swe-backend VẪN 0.276 (tệ nhất) do hardware NVIDIA/Amazon Ring còn lại — đây là bằng chứng "engineer là generic term, hardware↔software split cần embedding sub-family, KHÔNG regex". Nguyên tắc đã ghi vào tuning_plan §B. aggregate +0.014 vs baseline gốc là tổng A+B1.

| C1 | 07-15 | `sen_mult × years_mult` → `min(sen,years)` (bỏ double-penalty) | 0.710 | 0.863 | +0.153 | +0.000 | 0 | KEEP (principled, eval-NEUTRAL — trigger hiếm) | (pending) |

**Ghi chú C1**: đây là điểm 1 critique gốc. Eval KHÔNG đổi vì `years_mult` phần lớn=1.0 (regex required-years ít bắt) → `min(sen,1)=sen=sen×1`, hai vế chỉ khác khi CẢ HAI bắn, ca đó hiếm trong pool. `min ≤ product` nên chỉ nới phạt kép, không thể làm tệ hơn (0 regression xác nhận). Giữ vì đúng nguyên tắc + vô hại; sẽ có ích khi years-extraction tốt hơn hoặc data đa dạng hơn. FINDING PHỤ: trục years-fit đang gần như bất động (regex JD yếu) — đáng cải thiện extraction trước khi tin trục này.
