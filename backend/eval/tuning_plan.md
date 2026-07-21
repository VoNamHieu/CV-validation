# Plan: vá engine + đo bằng harness (2026-07-15)

## Baseline đóng băng (nhãn v2, IDCG chung, pool 14/07)

| metric | giá trị |
|---|---|
| facet-only NDCG@10 | **0.696** |
| +rerank NDCG@10 | **0.863** |
| Δ rerank | +0.167 (CI [+0.107, +0.231]) |
| Ca facet tệ nhất | swe-backend-junior 0.234 · pm-to-ops 0.255 · hr-recruiter 0.307 · audit-to-fpna 0.331 · finance-analyst 0.393 · finance-manager 0.397 |

**Noise floor**: inter-judge exact 67% (±1 = 100%) → mean-Δ dưới ~0.015 không phân biệt được với nhiễu nhãn. Ngưỡng chấp nhận đặt ở +0.02.

## Vòng đo chuẩn — chạy cho MỖI patch, không gộp

```
1. pytest tests/test_search.py tests/test_ranking_bugs.py     # gate hồi quy (49 test)
2. python3 -m eval.eval_ranking score                          # ~30s, 0 API call
3. Coverage guard phải = 0. Nếu >0: patch đã đổi top-10
   → python3 -m eval.eval_ranking sheet → judge NHỮNG DÒNG MỚI (rubric v2, 2 chiều)
   → merge → score lại. KHÔNG so sánh khi coverage > 0.
4. So baseline: mean Δ_facet + bootstrap CI + diff per-profile
   (mọi profile rớt > 0.05 phải giải thích được, không thì reject)
5. Ghi vào eval/experiments.md: patch, số trước/sau, verdict, commit hash
```

**Tiêu chí**: ACCEPT nếu mean Δ_facet ≥ +0.02 và CI-dưới ≥ −0.01 và các profile-mục-tiêu nhích đúng hướng. REJECT nếu mean < 0. Vùng xám (0 → +0.02): giữ nếu patch đúng về nguyên lý (sửa phân loại sai rõ ràng), bỏ nếu chỉ là tuning.

---

## Phase A — vá rẻ, rủi ro thấp (hôm nay)

### A1. Lookahead `bao hanh`
- **Sửa**: `taxonomy.py` — `truong nhom ky thuat(?!\s*(so|seo)\b)` → thêm `|bao hanh`. Collision do chính patch 15/07 gây ra ("Trưởng Nhóm Kỹ Thuật Bảo Hành" = warranty repair → đang lọt vào Engineering).
- **Kỳ vọng**: `swe-tech-lead-vn` facet ↑ nhẹ hoặc đứng yên; không profile nào rớt.
- **Đo**: vòng chuẩn + edge case pytest mới (`bảo hành` → NOT Engineering).

### A2. Garbage + keyword-trap "TUYỂN DỤNG"
- **Sửa** (2 phần):
  1. `career.py _is_garbage_title`: thêm `skip to main content` (+ biến thể nav tiếng Anh); áp filter cho CẢ đường DB pool (hiện chỉ lọc featured path). Harness `_load_pool` import cùng hàm để đo trên pool đóng băng mà không re-dump.
  2. `taxonomy.py classify_title`: strip prefix `tuyển dụng`/`hiring`/`tuyển gấp` khỏi title TRƯỚC khi match rule (giống `_TITLE_TAG`). "TUYỂN DỤNG DƯỢC SĨ" hiện match `tuyen dung` → Human Resources (sai — đó là job dược sĩ).
- **Kỳ vọng**: `hr-recruiter-entry-vn` (0.307) ↑ mạnh; `ops-coordinator`/`hr-generalist` ↑ nhẹ.
- **Rủi ro**: title thật sự là job tuyển dụng kiểu "Tuyển dụng Chuyên viên Tuyển dụng" — strip prefix xong vẫn còn `tuyen dung` phía sau → vẫn HR. Viết test case này.

### A3. Commit checkpoint — branch `feat/search-eval-harness`
- Gồm: `taxonomy.py`, `profile.py` (patch 15/07 + A1 + A2), `eval/` (scripts, profiles, pool.jsonl, to_label*.csv, judge_raw/, plan này).
- `.gitignore`: `eval/emb_cache.json` (~vài chục MB, regenerate được với ~$0.02).
- KHÔNG đụng `frontend/src/components/landing/` (frozen) và `featured_companies.py` (thay đổi có sẵn từ trước, ngoài phạm vi).

## Phase B — precision taxonomy (sau khi A xanh)

### B1. Siết bare `engineer`
- **Vấn đề**: khách sạn/facility/hardware engineer → Engineering family; `swe-backend-junior` 0.234 là ca tệ nhất toàn bảng, rerank cũng chỉ cứu lên 0.409.
- **Sửa đề xuất**: negative lookahead theo ngữ cảnh phi-software: `engineer(?!.*(hotel|facility|facilities|maintenance|bao tri|hvac|electrical|mechanical|civil|chief engineer))` — HOẶC tách các title đó về Manufacturing/Operations bằng rule đứng trước. Chọn phương án sau khi liệt kê mọi title chứa "engineer" trong pool (grep pool.jsonl, ~1 phút) — sửa theo dữ liệu thật, không đoán.
- **Kỳ vọng**: `swe-backend-junior` ↑ rõ; canh chừng `swe-mobile`/`swe-frontend` không rớt.
- **Rủi ro cao nhất Phase B** — bare `engineer` đang gánh rất nhiều title đúng. Bắt buộc chạy phân loại toàn pool trước/sau, diff mọi job đổi family, đọc tay danh sách diff.

### B2. Teller/tín dụng flood (finance)
- **Ghi nhận nhưng HOÃN**: `giao dịch viên` đúng là Finance family — vấn đề là sub-family (analyst vs branch ops), coarse taxonomy không tả được. Rerank đã bù tốt (finance-analyst +0.451). Fix thật = specialization qua embedding clusters (đúng search-design). Không regex-hack.

## Phase C — công thức facet (từng cái một, sau B)

### C1. `sen_mult × years_mult` → `min(sen_mult, years_mult)`
- Hai trục đo cùng construct "quá tầm kinh nghiệm" — nhân dồn phạt kép (0.75×0.5=0.375 cho job chỉ hơi quá tầm). `min` = lấy ràng buộc binding.
- **Kỳ vọng**: profile Junior/Entry ↑ (bớt phạt oan job Mid yêu cầu 2-3 năm); pivot Senior không đổi nhiều.
- Đây là thay đổi hành vi diện rộng → soi kỹ per-profile diff, dễ cần label bổ sung.

### C2. De-dup `role_w × fit_mult` cho non-pivot
- Khi target ≈ CV (không pivot thật), cả hai đọc cùng ROLE_ADJACENCY → penalty adjacency bị bình phương (0.65² = 0.42).
- **Sửa**: chỉ nhân `fit_mult` khi `cv_families` khác family của `role_w` nguồn (pivot thật); non-pivot → fold.
- **Kỳ vọng**: profile non-pivot có job family kề ↑.

## Phase D — sweep `_W_COS` (0.3 → 0.4 → 0.5)
- Data v2 gợi ý cosine đáng tin hơn trong tier (rerank thắng 33/40). Mỗi giá trị: score → gần như chắc chắn cần label bổ sung (top-10 đổi) → sheet + judge dòng mới.
- Nhận giá trị tốt nhất theo mean NDCG **+rerank**; tie-break = ít ca rớt nhất.

## Phase E — industry adjacency graph
- Gate: chỉ làm sau khi A–C chốt (tránh tune weight mới trên nền đang dịch chuyển). Mirror ROLE_ADJACENCY cho 17 industries (fintech↔banking↔securities cao; fintech↔F&B thấp). First-pass weight tay → đo bằng harness; profile hiện có đủ domain coverage để thấy tín hiệu.

## Sổ thí nghiệm
Mọi lần `score` sau mỗi patch ghi vào `eval/experiments.md` (bảng: ngày, patch, mean facet/rerank, Δ vs baseline, coverage, verdict, commit). Không có số trong sổ = chưa xảy ra.

## Định kỳ (sau khi A–D xong)
- Replication: dump pool mới + relabel (v3) như regression check — xác nhận verdict không phụ thuộc snapshot 14/07.
- Nâng nhãn: bạn/recruiter override dần cột grade trong `to_label.csv` từ `judge_review.md` (ưu tiên các dòng intent≠reach và grade 1↔2).
