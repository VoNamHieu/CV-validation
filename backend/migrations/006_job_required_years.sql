-- Minimum years of professional experience a job asks for, extracted at ingest
-- from the JD text. Feeds the facet ranking's years-fit demote so search agrees
-- with the optimize pipeline (a job can't rank #1 then read "too much
-- experience"). NULL = unknown → years-fit stays neutral. Additive + nullable.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS required_years_min int;
