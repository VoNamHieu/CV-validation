# System Research

Living notes on how the job-search / ranking system actually behaves — grounded in
eval batches, judged samples, and production observations. These are **durable,
maintained documents**, not scratch: each one carries a status header and a revision
log, and is meant to be updated as findings evolve rather than replaced.

Raw eval data and scripts live in [`backend/eval/`](../../eval/). This folder holds the
**interpretation** of that data — what the numbers mean for the ranker and what to change.

## Index

| Doc | Status | What it covers |
|---|---|---|
| [retrieval-quality-judge5.md](./retrieval-quality-judge5.md) | Active | Two-axis relevance judgment of eval batch `judge5`; diagnoses industry / seniority / role-function behavior of the ranker |

## Conventions

- **Status** — one of `Active` (current, trusted), `Superseded` (kept for history, see the
  replacement), or `Draft` (in progress, not yet trusted).
- **Revision log** — every doc ends with a dated log. Append; don't rewrite history.
- **Source of truth** — cite the exact eval artifact (`judge*-new.json`, `*-grades.json`,
  `pool.jsonl`, etc.) so any claim can be re-derived.
- **Sample-size honesty** — small batches are diagnostic, not benchmarks. State `n` and say
  whether magnitudes or only directions are trustworthy.
