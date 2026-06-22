"""Normalized job posting schema.

Every adapter ultimately yields one of these (today as a plain dict with the
core keys; richer fields are populated where the source exposes them). Having a
single shape is the foundation for the future search layer: ranking and
filtering need structured fields (salary, posted_at, seniority, …), not a loose
dict per adapter.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict


@dataclass
class Job:
    title: str
    url: str
    location: str = ""
    description: str = ""
    company: str = ""          # set by the aggregator (featured company name)
    source: str = ""           # adapter that produced it (workday, iviec, …)
    salary: str = ""           # free-text or "min–max" when available
    employment_type: str = ""  # full-time / part-time / intern …
    posted_at: str = ""        # ISO date when available
    category: str = ""         # department / function when available

    # Core keys every consumer relies on; extras are additive and optional.
    _CORE = ("title", "url", "location", "description")

    @classmethod
    def from_dict(cls, d: dict) -> "Job":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})

    def as_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v}
