"""
Featured Vietnamese and regional employers for the demo flow.

Each entry exposes the company's own careers page so the pipeline can run
Stage 4 (list jobs) directly — no TopCV/VNW discovery needed. This is the
short-term path used by the "Find jobs from my CV" button while the full
company-first refactor is built out.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeaturedCompany:
    name: str
    homepage: str
    career_url: str


FEATURED_COMPANIES: tuple[FeaturedCompany, ...] = (
    # ── Tech / Internet ───────────────────────────────────────────────
    FeaturedCompany(
        name="Shopee",
        homepage="https://shopee.vn",
        career_url="https://careers.shopee.vn",
    ),
    FeaturedCompany(
        name="VNG",
        homepage="https://vng.com.vn",
        career_url="https://careers.vng.com.vn",
    ),
    FeaturedCompany(
        name="Tiki",
        homepage="https://tiki.vn",
        career_url="https://tuyendung.tiki.vn",
    ),
    FeaturedCompany(
        name="MoMo",
        homepage="https://momo.vn",
        career_url="https://momo.careers",
    ),
    FeaturedCompany(
        name="VNPAY",
        homepage="https://vnpay.vn",
        career_url="https://tuyendung.vnpay.vn",
    ),
    FeaturedCompany(
        name="Grab",
        homepage="https://grab.com",
        career_url="https://grab.careers",
    ),
    FeaturedCompany(
        name="Be",
        homepage="https://be.com.vn",
        career_url="https://be.com.vn/en/careers",
    ),
    FeaturedCompany(
        name="Lazada",
        homepage="https://www.lazada.vn",
        career_url="https://jobs.lazada.com",
    ),
    FeaturedCompany(
        name="Sea",
        homepage="https://www.sea.com",
        career_url="https://www.sea.com/careers",
    ),
    FeaturedCompany(
        name="TikTok",
        homepage="https://www.tiktok.com",
        career_url="https://careers.tiktok.com",
    ),
    FeaturedCompany(
        name="ByteDance",
        homepage="https://www.bytedance.com",
        career_url="https://jobs.bytedance.com",
    ),
    FeaturedCompany(
        name="Agoda",
        homepage="https://www.agoda.com",
        career_url="https://careers.agoda.com",
    ),
    FeaturedCompany(
        name="Traveloka",
        homepage="https://www.traveloka.com",
        career_url="https://www.traveloka.com/en-id/careers",
    ),
    FeaturedCompany(
        name="Klook",
        homepage="https://www.klook.com",
        career_url="https://hire-r1.mokahr.com/social-recruitment/klookcareers/100000176?locale=en-US#/jobs?location%5B0%5D=Vietnam&page=1&anchorName=jobsList",
    ),
    FeaturedCompany(
        name="KiotViet",
        homepage="https://kiotviet.vn",
        career_url="https://about.kiotviet.vn/cong-viec",
    ),
    FeaturedCompany(
        name="OpenCommerce Group",
        homepage="https://www.opencommercegroup.com",
        career_url="https://opencommercegroup.com/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="Trusting Social",
        homepage="https://trustingsocial.com",
        career_url="https://trustingsocial.com/careers",
    ),
    FeaturedCompany(
        name="Cake",
        homepage="https://cake.vn",
        career_url="https://jobs.lever.co/cake",
    ),

    # ── FPT / Viettel ─────────────────────────────────────────────────
    FeaturedCompany(
        name="FPT Software",
        homepage="https://fpt-software.com",
        career_url="https://career.fpt-software.com",
    ),
    FeaturedCompany(
        name="FPT IS",
        homepage="https://fptis.vn",
        career_url="https://careers.fptis.com",
    ),
    FeaturedCompany(
        name="FPT Shop",
        homepage="https://fptshop.com.vn",
        career_url="https://career.fptshop.com.vn",
    ),
    FeaturedCompany(
        name="Viettel Software",
        homepage="https://viettelsoftware.com",
        career_url="https://career.viettelsoftware.com",
    ),
    FeaturedCompany(
        name="Viettel AI",
        homepage="https://viettelai.vn",
        career_url="https://viettelai.vn/en/tuyen-dung",
    ),
    FeaturedCompany(
        name="Viettel High Tech",
        homepage="https://viettelhightech.vn",
        career_url="https://viettelhightech.vn/danh-sach-tuyen-dung",
    ),

    # ── IT Services / Outsourcing ─────────────────────────────────────
    FeaturedCompany(
        name="NashTech",
        homepage="https://nashtechglobal.com",
        career_url="https://careers.nashtechglobal.com",
    ),
    FeaturedCompany(
        name="KMS Technology",
        homepage="https://kms-technology.com",
        career_url="https://kms-technology.com/careers",
    ),
    FeaturedCompany(
        name="Cốc Cốc",
        homepage="https://coccoc.com",
        career_url="https://careers.coccoc.com",
    ),
    FeaturedCompany(
        name="Axon Active",
        homepage="https://www.axonactive.com",
        career_url="https://www.axonactive.com/careers",
    ),
    FeaturedCompany(
        name="TMA Solutions",
        homepage="https://www.tmasolutions.com",
        career_url="https://www.tmasolutions.com/careers",
    ),
    FeaturedCompany(
        name="Rikkeisoft",
        homepage="https://rikkeisoft.com",
        career_url="https://careers.rikkeisoft.com",
    ),
    FeaturedCompany(
        name="CMC Global",
        homepage="https://cmcglobal.com.vn",
        career_url="https://careers.cmcglobal.com.vn",
    ),
    FeaturedCompany(
        name="Bosch",
        homepage="https://www.bosch.com.vn",
        career_url="https://careers.smartrecruiters.com/BoschGroup",
    ),
    FeaturedCompany(
        name="Renesas",
        homepage="https://www.renesas.com",
        career_url="https://careers.renesas.com",
    ),

    # ── Banking / Finance ─────────────────────────────────────────────
    FeaturedCompany(
        name="Techcombank",
        homepage="https://www.techcombank.com.vn",
        career_url="https://techcombankjobs.com",
    ),
    FeaturedCompany(
        name="MB Bank",
        homepage="https://www.mbbank.com.vn",
        career_url="https://tuyendung.mbbank.com.vn",
    ),
    FeaturedCompany(
        name="VPBank",
        homepage="https://vpbank.com.vn",
        career_url="https://tuyendung.vpbank.com.vn",
    ),
    FeaturedCompany(
        name="TPBank",
        homepage="https://tpbank.com.vn",
        career_url="https://tuyendung.tpbank.com.vn",
    ),
    FeaturedCompany(
        name="ACB",
        homepage="https://acb.com.vn",
        career_url="https://tuyendung.acb.com.vn",
    ),
    FeaturedCompany(
        name="HDBank",
        homepage="https://hdbank.com.vn",
        career_url="https://career.hdbank.com.vn",
    ),
    FeaturedCompany(
        name="Sacombank",
        homepage="https://www.sacombank.com.vn",
        career_url="https://tuyendung.sacombank.com",
    ),
    FeaturedCompany(
        name="MSB",
        homepage="https://msb.com.vn",
        career_url="https://jobs.msb.com.vn",
    ),
    FeaturedCompany(
        name="VIB",
        homepage="https://www.vib.com.vn",
        career_url="https://careers.vib.com.vn",
    ),
    FeaturedCompany(
        name="GPBank",
        homepage="https://gpbank.com.vn",
        career_url="https://tuyendung.gpbank.com.vn",
    ),

    # ── Retail / Consumer ─────────────────────────────────────────────
    FeaturedCompany(
        name="Thế Giới Di Động",
        homepage="https://thegioididong.com",
        career_url="https://vieclam.thegioididong.com",
    ),
    FeaturedCompany(
        name="PNJ",
        homepage="https://pnj.com.vn",
        career_url="https://tuyendung.pnj.com.vn",
    ),
    FeaturedCompany(
        name="WinMart",
        homepage="https://winmart.vn",
        career_url="https://careers.winmart.vn",
    ),
    FeaturedCompany(
        name="Masan Group",
        homepage="https://masangroup.com",
        career_url="https://careers.masangroup.com",
    ),
    FeaturedCompany(
        name="Highlands Coffee",
        homepage="https://highlandscoffee.com.vn",
        career_url="https://highlandscoffee.com.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="Pharmacity",
        homepage="https://pharmacity.vn",
        career_url="https://careers.pharmacity.vn",
    ),
    FeaturedCompany(
        name="Guardian",
        homepage="https://guardian.com.vn",
        career_url="https://guardianjobs.com.vn",
    ),
    FeaturedCompany(
        name="Unilever Vietnam",
        homepage="https://unilever.com.vn",
        career_url="https://careers.unilever.com/en/vietnam",
    ),
    FeaturedCompany(
        name="P&G Vietnam",
        homepage="https://vn.pg.com",
        career_url="https://www.pgcareers.com/global/en",
    ),
    FeaturedCompany(
        name="Vinpearl",
        homepage="https://vinpearl.com",
        career_url="https://vinpearl.talent.vn",
    ),

    # ── Logistics ─────────────────────────────────────────────────────
    FeaturedCompany(
        name="GHTK",
        homepage="https://ghtk.vn",
        career_url="https://ghtk.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="GHN",
        homepage="https://ghn.vn",
        career_url="https://ghn.vn/blogs/tuyen-dung",
    ),
    FeaturedCompany(
        name="Ninja Van",
        homepage="https://www.ninjavan.co",
        career_url="https://www.ninjavan.co/en-vn/careers",
    ),
    FeaturedCompany(
        name="Ahamove",
        homepage="https://ahamove.com",
        career_url="https://careers.ahamove.com",
    ),
    FeaturedCompany(
        name="DHL",
        homepage="https://www.dhl.com",
        career_url="https://careers.dhl.com",
    ),
    FeaturedCompany(
        name="Maersk",
        homepage="https://www.maersk.com",
        career_url="https://www.maersk.com/careers",
    ),

    # ── Consulting / Professional Services ───────────────────────────
    FeaturedCompany(
        name="McKinsey",
        homepage="https://www.mckinsey.com",
        career_url="https://www.mckinsey.com/careers",
    ),
    FeaturedCompany(
        name="Deloitte",
        homepage="https://www.deloitte.com/vn",
        career_url="https://jobs.deloitte.com",
    ),
    FeaturedCompany(
        name="PwC",
        homepage="https://www.pwc.com/vn",
        career_url="https://www.pwc.com/vn/en/careers.html",
    ),
    FeaturedCompany(
        name="EY",
        homepage="https://www.ey.com/en_vn",
        career_url="https://www.ey.com/en_vn/careers",
    ),
    FeaturedCompany(
        name="KPMG",
        homepage="https://kpmg.com/vn",
        career_url="https://home.kpmg/vn/en/home/careers.html",
    ),
    FeaturedCompany(
        name="Accenture",
        homepage="https://www.accenture.com/vn-en",
        career_url="https://www.accenture.com/vn-en/careers",
    ),
)
