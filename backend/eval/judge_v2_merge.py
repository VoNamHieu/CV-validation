"""Merge v2 two-dimensional judge labels (IntentMatch, Reachability) and report
inter-judge agreement from the 60-row cross-chunk overlap.

v2 rubric fixes the v1 flaw where grade-3 only required target-match — pivots
got 3s for aspirational jobs a recruiter wouldn't surface given the CV.
Final grade = min(intent, reach): a job must match the goal AND be credible
from the proven CV. Both dimensions are kept in to_label.csv so alternative
aggregations can be tried without re-labeling.

Usage: python3 -m eval.judge_v2_merge  (then python3 -m eval.eval_ranking score)
"""
import csv
import json
import shutil
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
SCRATCH = Path("/private/tmp/claude-501/-Users-mac-Documents-Code-CV-validation/"
               "f0d57cba-290e-46af-aaab-fe3333ab3cb0/scratchpad")
RAW = HERE / "judge_raw"


def main() -> None:
    # ── load chunk grades ────────────────────────────────────────────────────
    v2: dict[str, list[int]] = {}
    chunk_of: dict[str, int] = {}
    for i in range(5):
        g = json.loads((SCRATCH / f"judge2-grades-{i}.json").read_text())
        v2.update(g)
        for k in g:
            chunk_of[k] = i

    rows = list(csv.DictReader((HERE / "to_label.csv").open()))
    expected = {f'{r["profile_id"]}|{r["job_id"]}' for r in rows}
    missing = expected - set(v2)
    print(f"coverage: {len(v2)}/{len(expected)} keys, missing={len(missing)}")
    for k in sorted(missing)[:20]:
        print("  MISS:", k)
    if missing:
        print("→ chấm bổ sung trước khi merge; ABORT")
        return

    # ── inter-judge agreement on the overlap ────────────────────────────────
    ov = json.loads((SCRATCH / "judge2-grades-overlap.json").read_text())
    per_chunk: dict[int, list[tuple]] = {}
    for k, (i2, r2) in ov.items():
        if k not in v2:
            continue
        i1, r1 = v2[k]
        per_chunk.setdefault(chunk_of[k], []).append((i1, r1, i2, r2))
    pairs = [p for ps in per_chunk.values() for p in ps]
    n = len(pairs)

    def agree(idx1, idx2):
        exact = sum(1 for p in pairs if p[idx1] == p[idx2])
        within1 = sum(1 for p in pairs if abs(p[idx1] - p[idx2]) <= 1)
        return exact / n, within1 / n

    ei, wi = agree(0, 2)
    er, wr = agree(1, 3)
    # min-grade agreement — what actually feeds NDCG
    em = sum(1 for i1, r1, i2, r2 in pairs if min(i1, r1) == min(i2, r2)) / n
    wm = sum(1 for i1, r1, i2, r2 in pairs if abs(min(i1, r1) - min(i2, r2)) <= 1) / n
    print(f"\ninter-judge agreement (n={n} overlap rows):")
    print(f"  IntentMatch : exact {ei:.0%}  ±1 {wi:.0%}")
    print(f"  Reachability: exact {er:.0%}  ±1 {wr:.0%}")
    print(f"  min(I,R)    : exact {em:.0%}  ±1 {wm:.0%}")
    print("  per-chunk exact (min-grade) — soi judge lệch:")
    for c in sorted(per_chunk):
        ps = per_chunk[c]
        e = sum(1 for i1, r1, i2, r2 in ps if min(i1, r1) == min(i2, r2)) / len(ps)
        print(f"    chunk {c}: {e:.0%} ({len(ps)} rows)")

    # ── write v2 CSV (backup v1 once) ────────────────────────────────────────
    v1_bak = HERE / "to_label_v1.csv"
    if not v1_bak.exists():
        shutil.copy(HERE / "to_label.csv", v1_bak)
        print(f"\nbacked up v1 labels → {v1_bak.name}")
    out = []
    for r in rows:
        i, rc = v2[f'{r["profile_id"]}|{r["job_id"]}']
        out.append({**{k: r[k] for k in ("profile_id", "job_id", "title", "company",
                                          "facet_score", "cos")},
                    "intent": i, "reach": rc, "grade": min(i, rc),
                    "grade_v1": r.get("grade", "")})
    fields = ["profile_id", "job_id", "title", "company", "facet_score", "cos",
              "intent", "reach", "grade", "grade_v1"]
    with (HERE / "to_label.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out)

    dist = Counter(str(r["grade"]) for r in out)
    shift = Counter()
    for r in out:
        if r["grade_v1"] != "":
            shift[int(r["grade"]) - int(r["grade_v1"])] += 1
    print(f"\nv2 grade dist (min): {dict(sorted(dist.items()))}")
    print(f"v2 - v1 shift: {dict(sorted(shift.items()))}  (âm = v2 khắt khe hơn)")
    # persist raw v2 files next to v1's for audit
    for i in list(range(5)) + ["overlap"]:
        src = SCRATCH / f"judge2-grades-{i}.json"
        if src.exists():
            shutil.copy(src, RAW / src.name)
    shutil.copy(SCRATCH / "judge2-chunk-overlap.json", RAW / "judge2-chunk-overlap.json")
    print("raw v2 files copied → eval/judge_raw/")


if __name__ == "__main__":
    main()
