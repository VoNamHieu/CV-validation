# Retrieval Quality — judge5 batch

> **Status:** Active &nbsp;·&nbsp; **Owner:** eval &nbsp;·&nbsp; **Last updated:** 2026-07-15
> &nbsp;·&nbsp; **Source:** `backend/eval/` → `judge5-new.json`, `judge5-grades.json`

**What the judge5 batch tells us about the ranking engine.**

Six candidate–job pairs, hand-judged on two independent axes, read as a diagnostic slice of
the facet-ranked recommendation flow. The headline: the engine surfaces the right *industry*
reliably, but leaks on *seniority* and *role-function* — and those two leaks account for
every low score in the set.

| | |
|---|---|
| **Batch** | `judge5-new.json` |
| **Scope** | 4 profiles · 6 pairs |
| **Rubric** | IntentMatch × Reachability, integers 0–3 |
| **Grades** | `judge5-grades.json` |

---

## §1 · Method

Each posting carries two scores that are deliberately decoupled.

- **IntentMatch** measures the posting against what the candidate *wants* — their target
  role, seniority band, and domain preference — and ignores the CV entirely.
- **Reachability** measures the same posting against what the CV *proves* — the demonstrated
  role, years, and level — and ignores the target.

A job can be wanted but unreachable, or reachable but unwanted; separating the axes is what
lets us tell a *relevance* failure apart from a *credibility* failure.

Vietnamese title conventions were normalized before judging: `Nhân viên`/`Chuyên viên` as
individual-contributor bands, `CVC`/`CVCC` as senior IC, `Trưởng phòng` as manager,
`Giám đốc` as director. Company→industry was inferred where obvious (Acecook, TH,
Coca-Cola → FMCG; Cake → fintech; Standard Chartered, SHB → banking) and left unpenalized
where not.

---

## §2 · The scores

| Profile | Posting | Company | Intent | Reach |
|---|---|---|:---:|:---:|
| `sales-manager-senior` | Nhân viên Kiểm soát Kinh doanh | Acecook | 1 | 2 |
| `sales-manager-senior` | National Account Manager (Modern Trade) | Coca-Cola | **3** | **3** |
| `sales-manager-senior` | CV Điều phối Kinh doanh Xuất khẩu | TH Group | 2 | 2 |
| `finance-acct-junior` | Manager, Cash Management Operations | Standard Chartered | 1 | 1 |
| `finance-controller-lead` | CV/CVC Thu hồi Nợ qua Điện thoại | Cake | 1 | 1 |
| `hr-head` | CVCC Quản lý Năng lực Vận hành | SHB | 0 | 1 |

Mean IntentMatch **1.33** · Mean Reachability **1.67** · one double-3 · zero double-0.

---

## §3 · Finding one — industry is solved

**Every posting lands in the candidate's declared domain.**

Not one of the six low scores is caused by a wrong industry. FMCG candidates got FMCG
postings; banking candidates got banking; the fintech and financial-services matches were
in-sector too. Where the domain filter had a preference to honor, it honored it.

This is consistent with the facet engine doing its coarse-taxonomy job well — industry is
the axis where hand-labeled buckets plus embedding adjacency give the cleanest signal, and
the batch shows no leakage there.

> **Read:** domain routing is not the problem. Do not spend tuning budget here. The failures
> live one level down, *inside* the correct industry.

---

## §4 · Finding two — seniority still leaks

**The engine pulls postings the right function but the wrong level, in both directions.**

Three of the six pairs are seniority mismatches:

- The junior accountant was shown a **Manager**-level treasury role at Standard Chartered
  (1/1) — two bands above what a 2-year CV can carry.
- The finance **lead** (11 years) was shown a junior `CV/CVC` phone debt-collection role at
  Cake (1/1) — a steep demotion the target explicitly rules out.
- Within the sales profile, the two non-ideal hits (Acecook, TH) are both IC-level postings
  shown to a candidate targeting a `Trưởng phòng` manager seat.

The pattern is symmetric: the ranker **over-promotes** junior candidates and **over-demotes**
senior ones. That points to a seniority signal that is present but weakly weighted — it
nudges rather than gates. Prior work folded classification-confidence and seniority-fit into
`score_job`, but this batch suggests the seniority term is still too soft to prevent a
two-band jump from surfacing.

> **Recommendation:** treat a seniority gap of ≥2 bands as a *hard demotion*, not a soft
> penalty. A junior should effectively never see a Manager posting ranked as a top result,
> regardless of how strong the function and industry match are.

---

## §5 · Finding three — the function false-positive

**One posting is in-industry and near-level yet functionally unrelated — the only intent-0 in
the set.**

The HR-head candidate was shown SHB's **Quản lý Năng lực Vận hành** (operations-capability
management) at 0/1. Correct industry (banking, adjacent to their financial-services
preference), plausible seniority (senior IC / lead-ish) — and yet the function is
*operations*, not *human resources*. It scores 0 on intent because it is simply not the job
family the candidate wants, and only 1 on reachability because an HR business partner would
need a real pivot to be credible for it.

This is the most instructive miss in the batch. Industry and seniority both passed; the
ranker still surfaced a wrong-function role. The likely cause is embedding proximity —
"capability / operations / management" sits near HR-adjacent competency language in vector
space without being the same function. It is exactly the failure mode that coarse
hand-taxonomy is supposed to catch and that pure embedding similarity will not.

> **Recommendation:** gate on role-family taxonomy *before* embedding rank, so an operations
> posting can never enter an HR candidate's result set on semantic-neighborhood alone.
> Embedding similarity should re-rank *within* a family, not select the family.

---

## §6 · What worked

The single clean hit — Coca-Cola's National Account Manager for the FMCG sales manager (3/3)
— is the shape every result should take: right function (sales), right level (manager), right
industry (FMCG), and a CV that proves the exact role. The TH export-coordination role (2/2)
is a defensible near-miss: right family and industry, one axis (level/specialization) off.
These two show the engine *can* produce well-aligned results; the batch's problem is
precision, not capability.

---

## §7 · Priorities

1. **P0 — Role-family gate.** Prevent cross-function leakage (the SHB case) by requiring
   taxonomy-family agreement before a posting is eligible to rank. Highest leverage: it
   converts an intent-0 into a non-result.
2. **P1 — Hard seniority demotion at ≥2 bands.** Stops both the over-promotion
   (junior → Manager) and over-demotion (lead → junior IC) failures, which together are half
   the batch.
3. **P2 — Keep the domain filter as-is.** It is the one component with zero errors here;
   leave it alone and protect it from regressions.

**Caveat:** n=6 is a diagnostic slice, not a benchmark. The direction of each failure is
clear, but magnitudes (mean scores, band widths) should be re-estimated on a larger judged
set before they drive threshold values.

---

## Open questions / follow-ups

- [ ] Re-run on a ≥50-pair judged set to convert the directional findings into threshold
      values (§4 band-gap cutoff, §5 family-gate strictness).
- [ ] Confirm whether `score_job`'s current seniority term is soft-penalty or gate, and where
      the two-band jumps originate.
- [ ] Check whether the SHB operations leak is embedding-only or also mis-tagged in the
      role-family taxonomy.

---

## Revision log

- **2026-07-15** — Initial note from the judge5 batch (4 profiles, 6 pairs). Established the
  three findings and P0–P2 priorities. — eval
