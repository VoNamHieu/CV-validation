"""Measure classify_seniority(title) against hand-labeled true bands.

Stratified sample (60 titles where the regex fires + 60 where it returns None),
labeled blind. Reports:
  - Precision on the FIRED stratum (regex band vs judge band; exact + ±1).
  - Miss rate on the NONE stratum (regex said None, judge found a real level).
  - Population-reweighted recall (base rate 771 fired / 1202 none unique titles).
  - The actual missed titles → concrete vocab gaps to add (no JD, no LLM).

Usage: python3 -m eval.senior_eval
"""
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
SCRATCH = Path("/private/tmp/claude-501/-Users-mac-Documents-Code-CV-validation/"
               "f0d57cba-290e-46af-aaab-fe3333ab3cb0/scratchpad")
BANDS = ("Intern/Fresher", "Junior", "Mid", "Senior", "Lead/Manager", "Director/Head+")
IDX = {b: i for i, b in enumerate(BANDS)}
N_FIRED, N_NONE = 771, 1202  # unique-title base rates (see sampling)


def main() -> None:
    sample = json.loads((HERE / "senior_sample.json").read_text())
    labels = {}
    for h in (0, 1):
        labels.update(json.loads((SCRATCH / f"senior-labels-{h}.json").read_text()))
    if len(labels) < len(sample):
        print(f"labels incomplete: {len(labels)}/{len(sample)} — judges not done")
        return

    fired = [(i, u) for i, u in enumerate(sample) if u["band"]]
    none = [(i, u) for i, u in enumerate(sample) if not u["band"]]

    # ── FIRED stratum → precision ────────────────────────────────────────────
    exact = offby1 = falsefire = 0
    wrong = []
    for i, u in fired:
        rb, jb = u["band"], labels[str(i)]
        if jb == "None":
            falsefire += 1
            wrong.append((u["title"], rb, "None (no level in title)"))
        elif rb == jb:
            exact += 1
        else:
            d = abs(IDX[rb] - IDX[jb])
            if d == 1:
                offby1 += 1
            wrong.append((u["title"], rb, jb))
    nf = len(fired)
    tp_rate = sum(1 for i, u in fired if labels[str(i)] != "None") / nf

    # ── NONE stratum → miss rate ─────────────────────────────────────────────
    misses = [(u["title"], labels[str(i)]) for i, u in none if labels[str(i)] != "None"]
    nn = len(none)
    fn_rate = len(misses) / nn

    # ── population reweight ──────────────────────────────────────────────────
    TP, FP, FN = N_FIRED * tp_rate, N_FIRED * (1 - tp_rate), N_NONE * fn_rate
    recall = TP / (TP + FN) if TP + FN else 0.0
    exact_pop_prec = exact / nf

    print(f"=== classify_seniority accuracy (n={len(sample)} unique titles) ===\n")
    print(f"FIRED stratum (regex gave a band), n={nf}:")
    print(f"  exact band match : {exact}/{nf} ({exact/nf:.0%})")
    print(f"  within ±1 band   : {(exact+offby1)}/{nf} ({(exact+offby1)/nf:.0%})")
    print(f"  FALSE FIRE (judge says title has no level): {falsefire}/{nf} ({falsefire/nf:.0%})\n")
    print(f"NONE stratum (regex returned None), n={nn}:")
    print(f"  judge agrees no level : {nn-len(misses)}/{nn} ({(nn-len(misses))/nn:.0%})")
    print(f"  MISS (title HAS a level regex didn't catch): {len(misses)}/{nn} ({fn_rate:.0%})\n")
    print("Population estimate (reweighted to 771 fired / 1202 none):")
    print(f"  band-signal PRECISION (exact): {exact_pop_prec:.0%}")
    print(f"  band-signal RECALL           : {recall:.0%}   ← catch được bao nhiêu title THỰC SỰ có band\n")

    if wrong:
        print("--- FIRED errors (regex band → judge band) ---")
        for t, rb, jb in wrong[:30]:
            print(f"  {rb:16} → {jb:26} | {t[:50]!r}")
    if misses:
        print(f"\n--- MISSES: title có band mà regex bỏ (n={len(misses)}) — lỗ hổng vocab ---")
        for band, group in _group(misses).items():
            print(f"  [{band}] ({len(group)})")
            for t in group[:8]:
                print(f"      {t[:56]!r}")


def _group(misses):
    out = {}
    for t, b in misses:
        out.setdefault(b, []).append(t)
    return dict(sorted(out.items(), key=lambda kv: -len(kv[1])))


if __name__ == "__main__":
    main()
