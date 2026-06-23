"""Search layer: CV → ranked jobs.

Coarse facet matching (taxonomy + company_industry + facet) today; the
embedding/rerank + store-backed retrieval layers land here as they're built.
Kept separate from the crawl/ingest domain (career_finder, ats_adapters,
spa_sniff) so the search engine has one home as it grows.
"""
