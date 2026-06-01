"""
Featured Vietnamese tech employers for the demo flow.

Each entry exposes the company's own careers page so the pipeline can run
Stage 4 (list jobs) directly — no TopCV/VNW discovery needed. This is the
short-term path used by the "Find jobs from my CV" button while the full
company-first refactor is built out.

Keep this list short (≤20 entries). Add a new company by giving its display
name, apex homepage, and the most jobs-rich careers URL you can find on it.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeaturedCompany:
    name: str
    homepage: str
    career_url: str


FEATURED_COMPANIES: tuple[FeaturedCompany, ...] = (
    FeaturedCompany(
        name="Shopee",
        homepage="https://shopee.vn",
        career_url="https://careers.shopee.vn/",
    ),
    FeaturedCompany(
        name="FPT Software",
        homepage="https://fpt-software.com",
        career_url="https://career.fpt-software.com/jobs-search",
    ),
    FeaturedCompany(
        name="FPT IS",
        homepage="https://fptis.vn",
        career_url="https://careers.fptis.com/vi/jobs?slug=yL36wq",
    ),
    FeaturedCompany(
        name="Viettel Software",
        homepage="https://viettelsoftware.com",
        career_url="https://career.viettelsoftware.com/jobList",
    ),
    FeaturedCompany(
        name="Viettel High Tech",
        homepage="https://viettelhightech.vn",
        career_url="https://viettelhightech.vn/danh-sach-tuyen-dung",
    ),
    FeaturedCompany(
        name="Viettel AI",
        homepage="https://viettelai.vn",
        career_url="https://viettelai.vn/en/tuyen-dung",
    ),
    FeaturedCompany(
        name="VNPAY",
        homepage="https://vnpay.vn",
        career_url="https://tuyendung.vnpay.vn/",
    ),
    FeaturedCompany(
        name="MoMo",
        homepage="https://momo.vn",
        career_url="https://momo.careers/",
    ),
    FeaturedCompany(
        name="Vinpearl",
        homepage="https://vinpearl.com",
        career_url="https://vinpearl.talent.vn",
    ),
    FeaturedCompany(
        name="OpenCommerce Group",
        homepage="https://www.opencommercegroup.com",
        career_url="https://www.opencommercegroup.com/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="VPBank",
        homepage="https://vpbank.com.vn",
        career_url="https://tuyendung.vpbank.com.vn/",
    ),
    FeaturedCompany(
        name="GPBank",
        homepage="https://gpbank.com.vn",
        career_url="https://tuyendung.gpbank.com.vn/",
    ),
    FeaturedCompany(
        name="KiotViet",
        homepage="https://kiotviet.vn",
        career_url="https://about.kiotviet.vn/cong-viec/",
    ),
    FeaturedCompany(
        name="Unilever Vietnam",
        homepage="https://unilever.com.vn",
        career_url="https://careers.unilever.com/en/vietnam",
    ),
    FeaturedCompany(
        name="P&G Vietnam",
        homepage="https://vn.pg.com",
        career_url="https://www.pgcareers.com/global/en/locations/vietnam",
    ),
    FeaturedCompany(
        name="Grab",
        homepage="https://grab.com",
        career_url="https://www.grab.careers/en/jobs/?orderby=0&pagesize=20&page=1&location=HCMC&country=Vietnam",
    ),
    FeaturedCompany(
        name="Be",
        homepage="https://be.com.vn",
        career_url="https://be.com.vn/ve-be/tuyen-dung/",
    ),
)
