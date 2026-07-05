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
        career_url="https://careers.shopee.vn/jobs",
    ),
    FeaturedCompany(
        name="VNG",
        homepage="https://vng.com.vn",
        career_url="https://career.vng.com.vn/vi/tim-kiem-viec-lam",
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
        career_url="https://www.grab.careers/en/jobs/?orderby=0&pagesize=20&page=1&location=HCMC&country=Vietnam",
    ),
    FeaturedCompany(
        name="Be",
        homepage="https://be.com.vn",
        career_url="https://be.com.vn/ve-be/tuyen-dung/",
    ),
    FeaturedCompany(
        name="Lazada",
        homepage="https://www.lazada.vn",
        career_url="https://www.lazada.com/en/careers/job-search/?category=&location=VNM",
    ),
    FeaturedCompany(
        name="Sea",
        homepage="https://www.sea.com",
        career_url="https://career.sea.com/jobs",
    ),
    FeaturedCompany(
        name="TikTok",
        homepage="https://www.tiktok.com",
        career_url="https://careers.tiktok.com",
    ),
    FeaturedCompany(
        name="ByteDance",
        homepage="https://www.bytedance.com",
        career_url="https://jobs.bytedance.com/en/position?keyword=Vietnam",
    ),
    FeaturedCompany(
        name="Agoda",
        homepage="https://www.agoda.com",
        career_url="https://careersatagoda.com/vacancies/?keyword=&country=vietnam",
    ),
    FeaturedCompany(
        name="Traveloka",
        homepage="https://www.traveloka.com",
        career_url="https://careers.traveloka.com/jobs?location=VN",
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
        career_url="https://cake.vn/tuyen-dung/jobs",
    ),
    FeaturedCompany(
        name="Visa",
        homepage="https://www.visa.com.vn",
        career_url="https://visa.wd5.myworkdayjobs.com/Visa?locationCountry=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="Mastercard",
        homepage="https://www.mastercard.com",
        career_url="https://careers.mastercard.com/us/en/search-results",
    ),

    # ── Agency / Media / Marketing ────────────────────────────────────
    FeaturedCompany(
        name="Ogilvy",
        homepage="https://www.ogilvy.com",
        career_url="https://boards.greenhouse.io/ogilvy",
    ),
    FeaturedCompany(
        name="Dentsu",
        homepage="https://www.dentsu.com",
        career_url="https://dentsuaegis.wd3.myworkdayjobs.com/en-US/DAN_GLOBAL/?locationCountry=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="CleverAds",
        homepage="https://cleverads.vn",
        career_url="https://cleverads.vn/tuyen-dung/",
    ),
    FeaturedCompany(
        name="SEONGON",
        homepage="https://seongon.com",
        career_url="https://seongon.com/tuyen-dung",
    ),
    FeaturedCompany(
        name="Vietcetera",
        homepage="https://vietcetera.com",
        career_url="https://vietcetera.com/careers",
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
        career_url="https://tuyendung.frt.vn/",
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
        career_url="https://www.tma.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="Rikkeisoft",
        homepage="https://rikkeisoft.com",
        career_url="https://tuyendung.rikkeisoft.com/recruitment/list-job",
    ),
    FeaturedCompany(
        name="CMC Global",
        homepage="https://cmcglobal.com.vn",
        career_url="https://cmcglobal.com.vn/career/",
    ),
    FeaturedCompany(
        name="Bosch",
        homepage="https://www.bosch.com.vn",
        career_url="https://careers.smartrecruiters.com/BoschGroup",
    ),
    FeaturedCompany(
        name="Renesas",
        homepage="https://www.renesas.com",
        career_url="https://jobs.renesas.com/jobs?options=817&page=1&q=vietnam",
    ),

    # ── Banking / Finance ─────────────────────────────────────────────
    FeaturedCompany(
        name="Vietcombank",
        homepage="https://vietcombank.com.vn",
        career_url="https://tuyendung.vietcombank.com.vn/viewalljobs/",
    ),
    FeaturedCompany(
        name="BIDV",
        homepage="https://bidv.com.vn",
        career_url="https://tuyendung.bidv.com.vn/co-hoi-nghe-nghiep.html",
    ),
    FeaturedCompany(
        name="VietinBank",
        homepage="https://vietinbank.vn",
        career_url="https://tuyendung.vietinbank.vn",
    ),
    FeaturedCompany(
        name="Agribank",
        homepage="https://agribank.com.vn",
        career_url="https://www.agribank.com.vn/vn/tuyen-dung/chuong-trinh-tuyen-dung",
    ),
    FeaturedCompany(
        name="SHB",
        homepage="https://shb.com.vn",
        career_url="https://tuyendung.shb.com.vn/",
    ),
    FeaturedCompany(
        name="SeABank",
        homepage="https://seabank.com.vn",
        career_url="https://tuyendung.seabank.com.vn",
    ),
    FeaturedCompany(
        name="OCB",
        homepage="https://ocb.com.vn",
        career_url="https://tuyendung.ocb.com.vn",
    ),
    FeaturedCompany(
        name="Eximbank",
        homepage="https://eximbank.com.vn",
        career_url="https://tuyendungeximbank.com/vi",
    ),
    FeaturedCompany(
        name="Techcombank",
        homepage="https://www.techcombank.com.vn",
        career_url="https://www.techcombankjobs.com/search-results",
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
        career_url="https://tuyendung.tpb.vn/vi/jobs",
    ),
    FeaturedCompany(
        name="ACB",
        homepage="https://acb.com.vn",
        career_url="https://www.acbjobs.com.vn/alljobs",
    ),
    FeaturedCompany(
        name="Sacombank",
        homepage="https://www.sacombank.com.vn",
        career_url="https://sacombankcareer.com/viewalljobs/",
    ),
    FeaturedCompany(
        name="MSB",
        homepage="https://msb.com.vn",
        career_url="https://jobs.msb.com.vn",
    ),
    FeaturedCompany(
        name="VIB",
        homepage="https://www.vib.com.vn",
        career_url="https://careers.vib.com.vn/careers",
    ),
    FeaturedCompany(
        name="GPBank",
        homepage="https://gpbank.com.vn",
        career_url="https://tuyendung.gpbank.com.vn",
    ),

    # ── Retail / Consumer ─────────────────────────────────────────────
    FeaturedCompany(
        name="Central Retail",
        homepage="https://centralretail.com.vn",
        career_url="https://centralretail.talent.vn",
    ),
    FeaturedCompany(
        name="Vinamilk",
        homepage="https://vinamilk.com.vn",
        career_url="https://www.vinamilk.com.vn/en/recruitment/career-opportunities",
    ),
    FeaturedCompany(
        name="Heineken Vietnam",
        homepage="https://heinekenvietnam.com",
        career_url="https://careers.theheinekencompany.com/Tieng-Viet/HEINEKEN-Vietnam",
    ),
    FeaturedCompany(
        name="FE Credit",
        homepage="https://fecredit.com.vn",
        career_url="https://tuyendung.fecredit.com.vn/ung-tuyen/",
    ),
    FeaturedCompany(
        name="F88",
        homepage="https://f88.vn",
        career_url="https://vieclam.f88.vn/tin-tuyen-dung",
    ),
    FeaturedCompany(
        name="FPT Securities",
        homepage="https://fpts.com.vn",
        career_url="https://www.fpts.com.vn/co-hoi-nghe-nghiep/",
    ),
    FeaturedCompany(
        name="Hoa Sen Group",
        homepage="https://hoasengroup.vn",
        career_url="https://hoasenjobs.com/",
    ),
    FeaturedCompany(
        name="Hop Nhat Logistics",
        homepage="https://hopnhat.com",
        career_url="https://hopnhat.com/recruitment",
    ),
    FeaturedCompany(
        name="UrBox",
        homepage="https://urbox.vn",
        career_url="https://talent.urbox.vn/alljobs?return=1",
    ),
    FeaturedCompany(
        name="Apollo English",
        homepage="https://apollo.edu.vn",
        career_url="https://apollo.edu.vn/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="Nestlé Vietnam",
        homepage="https://nestle.com.vn",
        career_url="https://jobdetails.nestle.com/search-results",
    ),
    FeaturedCompany(
        name="Coca-Cola",
        homepage="https://coca-colacompany.com",
        career_url="https://careersvn.app.swirecocacola.com/search/",
    ),
    FeaturedCompany(
        name="PepsiCo",
        homepage="https://pepsico.com",
        career_url="https://careers.pepsico.com",
    ),
    FeaturedCompany(
        name="Ajinomoto Vietnam",
        homepage="https://ajinomoto.com.vn",
        career_url="https://www.ajinomoto.com.vn/vi/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="Acecook Vietnam",
        homepage="https://acecookvietnam.vn",
        career_url="https://acecookcareer.com/",
    ),
    FeaturedCompany(
        name="Suntory PepsiCo Vietnam",
        homepage="https://suntorypepsico.vn",
        career_url="https://careers.suntorybeverageandfood.com/search/?createNewAlert=false&q=&locationsearch=vietnam",
    ),
    FeaturedCompany(
        name="TH Group",
        homepage="https://thmilk.vn",
        career_url="https://jobs.thgroupglobal.com/search/?q=",
    ),
    FeaturedCompany(
        name="Mondelez Kinh Do",
        homepage="https://mondelezinternational.com",
        career_url="https://www.mondelezinternational.com/careers/jobs/?term=&countrycode=VN",
    ),
    FeaturedCompany(
        name="Orion Vietnam",
        homepage="https://orion.vn",
        career_url="https://orion.vn/tuyen-dung/viec-lam/",
    ),
    FeaturedCompany(
        name="247Express",
        homepage="https://247express.vn",
        career_url="https://247express.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="Sunhouse",
        homepage="https://sunhouse.com.vn",
        career_url="https://sunhouse.com.vn/tuyen-dung/xem-toan-bo-tin",
    ),
    FeaturedCompany(
        name="Vinasoy",
        homepage="https://vinasoy.com.vn",
        career_url="https://career.vinasoy.com/tim-viec-lam/tat-ca-viec-lam/vi",
    ),
    FeaturedCompany(
        name="Decathlon",
        homepage="https://decathlon.com",
        career_url="https://careersdecathlonvn.com/en/recruitments",
    ),
    FeaturedCompany(
        name="Adidas",
        homepage="https://adidas-group.com",
        # careers.adidas-group.com is a JS shell; the real board is the
        # SuccessFactors career site jobs.adidas-group.com. locationsearch=Vietnam
        # scopes it to VN (roles tagged "Hanoi, 64, VN" / "Ho Chi Minh City").
        career_url="https://jobs.adidas-group.com/search/?q=&locationsearch=Vietnam",
    ),
    FeaturedCompany(
        name="Nike",
        homepage="https://nike.com",
        career_url="https://careers.nike.com/vi/jobs?location_name=Ho%20Chi%20Minh%2C%20Vietnam&location_type=2",
    ),
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
        career_url="https://tuyendung.winmart.vn/alljobs?office=4999&return=1",
    ),
    FeaturedCompany(
        name="Masan Group",
        homepage="https://masangroup.com",
        career_url="https://careers.masanconsumer.com/search",
    ),
    FeaturedCompany(
        name="Highlands Coffee",
        homepage="https://highlandscoffee.com.vn",
        career_url="https://careers.highlandscoffee.com.vn/vi/viec-lam/",
    ),
    FeaturedCompany(
        name="Pharmacity",
        homepage="https://pharmacity.vn",
        career_url="https://corp.pharmacity.vn/tim-viec-lam/",
    ),
    FeaturedCompany(
        name="Guardian",
        homepage="https://guardian.com.vn",
        career_url="https://www.guardian.com.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="Unilever Vietnam",
        homepage="https://unilever.com.vn",
        career_url="https://careers.unilever.com/en/location/vietnam-jobs/34155/1562822/2",
    ),
    FeaturedCompany(
        name="P&G Vietnam",
        homepage="https://vn.pg.com",
        career_url="https://www.pgcareers.com/global/en/locations/vietnam",
    ),
    FeaturedCompany(
        name="Vinpearl",
        homepage="https://vinpearl.com",
        career_url="https://vinpearl.talent.vn",
    ),

    # ── Logistics ─────────────────────────────────────────────────────
    FeaturedCompany(
        name="Kuehne+Nagel",
        homepage="https://kuehne-nagel.com",
        career_url="https://careers.kuehne-nagel.com",
    ),
    FeaturedCompany(
        name="FedEx",
        homepage="https://fedex.com",
        career_url="https://careers.fedex.com/vi/jobs?location_name=Vietnam&location_type=4",
    ),
    FeaturedCompany(
        name="UPS",
        homepage="https://ups.com",
        career_url="https://www.jobs-ups.com/apac/vi/c/vi%E1%BB%87c-b%C3%A1n-h%C3%A0ng-jobs",
    ),
    FeaturedCompany(
        name="GHTK",
        homepage="https://ghtk.vn",
        career_url="https://ghtk.vn/tuyen-dung",
    ),
    FeaturedCompany(
        name="One Mount Group",
        homepage="https://onemount.com",
        career_url="https://careers.onemount.com/job-list",
    ),
    FeaturedCompany(
        name="Golden Gate Group",
        homepage="https://ggg.com.vn",
        career_url="https://ggg.talent.vn/",
    ),
    FeaturedCompany(
        name="GHN",
        homepage="https://ghn.vn",
        career_url="https://tuyendung.ghn.vn/recruit/",
    ),
    FeaturedCompany(
        name="Ninja Van",
        homepage="https://www.ninjavan.co",
        career_url="https://ninjavan.co/vi-vn/ve-cong-ty/careers#openings",
    ),
    FeaturedCompany(
        name="Ahamove",
        homepage="https://ahamove.com",
        career_url="https://ahamove.com/recruitment",
    ),
    FeaturedCompany(
        name="Avina Logistics",
        homepage="https://avinalogistics.com",
        career_url="https://avinalogistics.com/nghe-nghiep/",
    ),
    FeaturedCompany(
        name="DHL",
        homepage="https://www.dhl.com",
        career_url="https://careers.dhl.com/global/en/search-results?keywords=&location=Vietnam",
    ),
    FeaturedCompany(
        name="Nippon Express",
        homepage="https://www.nipponexpress.com",
        career_url="https://www.nipponexpress.com/careers/",
    ),
    FeaturedCompany(
        name="DSV",
        homepage="https://www.dsv.com",
        career_url="https://www.dsv.com/en/careers?q=%2A",
    ),
    FeaturedCompany(
        name="Hellmann",
        homepage="https://www.hellmann.com",
        career_url="https://www.hellmann.com/en/career",
    ),
    FeaturedCompany(
        name="Viettel Post",
        homepage="https://viettelpost.com.vn",
        career_url="https://viettelpost.com.vn/tuyen-dung/",
    ),
    FeaturedCompany(
        name="Gemadept",
        homepage="https://www.gemadept.com.vn",
        career_url="https://www.gemadept.com.vn/tuyen-dung/",
    ),
    FeaturedCompany(
        name="Bee Logistics",
        homepage="https://beelogistics.com",
        career_url="https://recruit.beelogistics.com/Customer/Career",
    ),
    FeaturedCompany(
        name="Maersk",
        homepage="https://www.maersk.com",
        career_url="https://maersk.wd3.myworkdayjobs.com/Maersk_Careers",
    ),

    # ── International Banking ─────────────────────────────────────────
    FeaturedCompany(
        name="DBS",
        homepage="https://dbs.com",
        career_url="https://dbs.wd3.myworkdayjobs.com/DBS_Careers?locationCountry=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="HSBC",
        homepage="https://hsbc.com",
        career_url="https://portal.careers.hsbc.com/careers?location=vietnam",
    ),
    FeaturedCompany(
        name="Standard Chartered",
        homepage="https://sc.com",
        career_url="https://jobs.standardchartered.com/search/?q=&locationsearch=Vietnam",
    ),
    FeaturedCompany(
        name="Citi",
        homepage="https://citibank.com",
        career_url="https://jobs.citi.com/search-jobs/Vietnam/287/2/1562822/16x16667/107x83333/50/2",
    ),
    # ── Insurance ─────────────────────────────────────────────────────
    FeaturedCompany(
        name="Sun Life Vietnam",
        homepage="https://sunlife.com.vn",
        career_url="https://www.sunlife.com.vn/vn/ve-chung-toi/tro-thanh-nhan-vien/vi-tri-tuyen-dung/",
    ),
    FeaturedCompany(
        name="Manulife",
        homepage="https://manulife.com.vn",
        career_url="https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs",
    ),
    FeaturedCompany(
        name="AIA",
        homepage="https://aia.com.vn",
        career_url="https://aia.wd3.myworkdayjobs.com/External",
    ),
    FeaturedCompany(
        name="Prudential",
        homepage="https://prudential.com.vn",
        career_url="https://prudential.wd3.myworkdayjobs.com/en-US/prudential",
    ),
    FeaturedCompany(
        name="Chubb",
        homepage="https://chubb.com",
        # Oracle HCM tenant (careers.chubb.com is a JS shell with no extractable
        # links); the recruitingCEJobRequisitions API serves VN jobs.
        career_url="https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/jobs",
    ),
    FeaturedCompany(
        name="Bảo Việt",
        homepage="https://baoviet.com.vn",
        career_url="https://baoviet.com.vn/vi/tuyen-dung",
    ),

    # ── Vingroup ──────────────────────────────────────────────────────
    FeaturedCompany(
        name="Vingroup",
        homepage="https://vingroup.net",
        career_url="https://tuyendung.vingroup.net/jobs",
    ),
    FeaturedCompany(
        name="Vinhomes",
        homepage="https://vinhomes.vn",
        career_url="https://careers.vinhomes.vn",
    ),
    FeaturedCompany(
        name="Vinschool",
        homepage="https://vinschool.edu.vn",
        career_url="https://tuyendung.vinschool.edu.vn/jobs?location=&type=&dept=684,430,431,432,433&return=1",
    ),
    FeaturedCompany(
        name="Vinmec",
        homepage="https://vinmec.com",
        career_url="https://vinmec.com/vie/tuyen-dung",
    ),

    # ── Electronics ───────────────────────────────────────────────────
    FeaturedCompany(
        name="Samsung",
        homepage="https://samsung.com",
        # Workday tenant: 3 clean VN jobs WITH JD via the adapter. The old
        # samsungcareers.com.vn SPA returned 14 entries but facility-code titles
        # (SEVT/SEV/SRV) and zero JD — useless for facet/embedding/tailoring.
        career_url="https://sec.wd3.myworkdayjobs.com/Samsung_Careers",
    ),
    FeaturedCompany(
        name="LG",
        homepage="https://lg.com",
        career_url="https://careers.lg.com",
    ),
    FeaturedCompany(
        name="Canon",
        homepage="https://canon.com",
        career_url="https://cvn.canon/vn/latestjob.html",
    ),
    FeaturedCompany(
        name="Hitachi",
        homepage="https://hitachi.com",
        career_url="https://careers.hitachi.com",
    ),
    FeaturedCompany(
        name="Sony",
        homepage="https://sony.com",
        career_url="https://www.sonyjobs.com/jobs.html",
    ),

    # ── Semiconductor ─────────────────────────────────────────────────
    FeaturedCompany(
        name="Marvell",
        homepage="https://marvell.com",
        career_url="https://marvell.wd1.myworkdayjobs.com/MarvellCareers?Country=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="Infineon",
        homepage="https://infineon.com",
        career_url="https://jobs.infineon.com/careers?domain=infineon.com&start=0&location=Vietnam&pid=563808961449920&sort_by=relevance&filter_include_remote=0",
    ),
    FeaturedCompany(
        name="NVIDIA",
        homepage="https://nvidia.com",
        career_url="https://jobs.nvidia.com/careers",
    ),
    FeaturedCompany(
        name="Qualcomm",
        homepage="https://qualcomm.com",
        career_url="https://careers.qualcomm.com",
    ),

    # ── Industrial / Manufacturing ────────────────────────────────────
    FeaturedCompany(
        name="Air Liquide",
        homepage="https://airliquide.com",
        career_url="https://airliquidehr.wd3.myworkdayjobs.com/AirLiquideExternalCareer?locationCountry=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="Siemens",
        homepage="https://siemens.com",
        career_url="https://jobs.siemens.com/en_US/externaljobs/SearchJobs/?42414=%5B812066%5D&42414_format=17570&listFilterMode=1&folderRecordsPerPage=6&",
    ),
    FeaturedCompany(
        name="Schneider Electric",
        homepage="https://schneider-electric.com",
        career_url="https://careers.se.com/jobs?lang=en-US&location=Vietnam&woe=12&regionCode=VN&stretchUnit=MILES&stretch=10&page=1",
    ),
    FeaturedCompany(
        name="ABB",
        homepage="https://abb.com",
        career_url="https://careers.abb/global/en/search-results?qcountry=Vietnam",
    ),
    FeaturedCompany(
        name="GE Vernova",
        homepage="https://gevernova.com",
        career_url="https://careers.gevernova.com",
    ),
    FeaturedCompany(
        name="3M",
        homepage="https://3m.com",
        career_url="https://3m.wd1.myworkdayjobs.com/en-US/Search",
    ),

    # ── Tobacco ───────────────────────────────────────────────────────
    FeaturedCompany(
        name="BAT",
        homepage="https://bat.com",
        career_url="https://careers.bat.com",
    ),
    # ── Hospitality ───────────────────────────────────────────────────
    FeaturedCompany(
        name="Marriott",
        homepage="https://marriott.com",
        career_url="https://careers.marriott.com",
    ),
    FeaturedCompany(
        name="Hilton",
        homepage="https://hilton.com",
        career_url="https://efet.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions",
    ),
    FeaturedCompany(
        name="Hyatt",
        homepage="https://hyatt.com",
        career_url="https://careers.hyatt.com",
    ),
    FeaturedCompany(
        name="Accor",
        homepage="https://accor.com",
        career_url="https://careers.accor.com",
    ),
    FeaturedCompany(
        name="IHG",
        homepage="https://ihg.com",
        # careers.ihg.com is a 403 anti-bot shell; the real board is IHG's
        # Oracle HCM candidate-experience tenant (siteName "IHG Career",
        # site CX_1001) → _oracle_hcm pulls VN reqs from its public REST API.
        career_url="https://fa-evax-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/",
    ),

    # ── Aviation ──────────────────────────────────────────────────────
    FeaturedCompany(
        name="Vietnam Airlines",
        homepage="https://www.vietnamairlines.com",
        career_url="https://skyhr.vietnamairlines.com/jobs",
    ),

    # ── Global Tech ───────────────────────────────────────────────────
    FeaturedCompany(
        name="Oracle",
        homepage="https://oracle.com",
        career_url="https://careers.oracle.com",
    ),
    FeaturedCompany(
        name="Microsoft",
        homepage="https://microsoft.com",
        career_url="https://apply.careers.microsoft.com/careers",
    ),
    FeaturedCompany(
        name="Google",
        homepage="https://google.com",
        career_url="https://careers.google.com",
    ),
    FeaturedCompany(
        name="IBM",
        homepage="https://ibm.com",
        career_url="https://careers.ibm.com",
    ),
    FeaturedCompany(
        name="SAP",
        homepage="https://sap.com",
        career_url="https://jobs.sap.com/go/SAP_Labs_Vietnam/9283701/",
    ),
    FeaturedCompany(
        name="Salesforce",
        homepage="https://salesforce.com",
        career_url="https://careers.salesforce.com",
    ),
    FeaturedCompany(
        name="ServiceNow",
        homepage="https://servicenow.com",
        career_url="https://careers.servicenow.com",
    ),
    FeaturedCompany(
        name="Atlassian",
        homepage="https://atlassian.com",
        career_url="https://www.atlassian.com/company/careers/all-jobs",
    ),

    # ── Consulting / Professional Services ───────────────────────────
    FeaturedCompany(
        name="McKinsey",
        homepage="https://www.mckinsey.com",
        career_url="https://www.mckinsey.com/careers/search-jobs?countries=Vietnam",
    ),
    FeaturedCompany(
        name="Deloitte",
        homepage="https://www.deloitte.com/vn",
        career_url="https://jobs.sea.deloitte.com/search/?q=&locationsearch=vietnam",
    ),
    FeaturedCompany(
        name="PwC",
        homepage="https://www.pwc.com/vn",
        career_url="https://www.pwc.com/vn/en/careers/experienced-jobs.html",
    ),
    FeaturedCompany(
        name="EY",
        homepage="https://www.ey.com/en_vn",
        career_url="https://careers.ey.com/ey/search/?q=&location=vn",
    ),
    FeaturedCompany(
        name="KPMG",
        homepage="https://kpmg.com/vn",
        career_url="https://careers.kpmg.com.vn/search/?createNewAlert=false&q=&locationsearch=vietnam",
    ),
    FeaturedCompany(
        name="TCBS",
        homepage="https://www.tcbs.com.vn",
        career_url="https://www.tcbs.com.vn/ve-chung-toi/tuyen-dung/",
    ),
    FeaturedCompany(
        name="VCBS",
        homepage="https://www.vcbs.com.vn",
        career_url="https://www.vcbs.com.vn/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="VPBank Securities",
        homepage="https://www.vpbanks.com.vn",
        career_url="https://www.vpbanks.com.vn/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="NAB Vietnam",
        homepage="https://www.nab.com.au",
        career_url="https://nab.wd3.myworkdayjobs.com/en-US/nab_careers?locationCountry=db69e8c8446c11de98360015c5e6daf6",
    ),
    FeaturedCompany(
        name="VPS",
        homepage="https://www.vps.com.vn",
        career_url="https://www.vps.com.vn/gia-nhap-vps/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="Base Inc",
        homepage="https://base.vn",
        career_url="https://baseinc.talent.vn/",
    ),
    FeaturedCompany(
        name="Amazon",
        homepage="https://www.amazon.com",
        career_url="https://www.amazon.jobs/en/locations/hanoi-vietnam",
    ),
)
