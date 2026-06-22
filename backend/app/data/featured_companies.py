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
        career_url="https://www.lazada.com/en/careers/",
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
        career_url="https://tuyendung.rikkeisoft.com/",
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
        career_url="https://tuyendung.agribank.com.vn",
    ),
    FeaturedCompany(
        name="SHB",
        homepage="https://shb.com.vn",
        career_url="https://jobs.shb.com.vn",
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
        name="NCB",
        homepage="https://ncb-bank.vn",
        career_url="https://tuyendung.ncb-bank.vn",
    ),
    FeaturedCompany(
        name="Eximbank",
        homepage="https://eximbank.com.vn",
        career_url="https://tuyendung.eximbank.com.vn",
    ),
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
        career_url="https://tuyendung.tpb.vn/vi/jobs",
    ),
    FeaturedCompany(
        name="ACB",
        homepage="https://acb.com.vn",
        career_url="https://www.acbjobs.com.vn/alljobs",
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
        name="Central Retail",
        homepage="https://centralretail.com.vn",
        career_url="https://centralretail.talent.vn",
    ),
    FeaturedCompany(
        name="Vinamilk",
        homepage="https://vinamilk.com.vn",
        career_url="https://careers.vinamilk.com.vn",
    ),
    FeaturedCompany(
        name="Sabeco",
        homepage="https://sabeco.com.vn",
        career_url="https://career.sabeco.com.vn",
    ),
    FeaturedCompany(
        name="Heineken Vietnam",
        homepage="https://heinekenvietnam.com",
        career_url="https://careers.theheinekencompany.com/Tieng-Viet/Job-Listing?operatings_company%5B0%5D=524",
    ),
    FeaturedCompany(
        name="Nestlé Vietnam",
        homepage="https://nestle.com.vn",
        career_url="https://www.nestle.com/jobs/search-jobs?keyword=&country=VN",
    ),
    FeaturedCompany(
        name="Coca-Cola",
        homepage="https://coca-colacompany.com",
        career_url="https://careers.coca-colacompany.com",
    ),
    FeaturedCompany(
        name="PepsiCo",
        homepage="https://pepsico.com",
        career_url="https://careers.pepsico.com",
    ),
    FeaturedCompany(
        name="Ajinomoto Vietnam",
        homepage="https://ajinomoto.com.vn",
        career_url="https://career.ajinomoto.com.vn",
    ),
    FeaturedCompany(
        name="Acecook Vietnam",
        homepage="https://acecookvietnam.vn",
        career_url="https://career.acecookvietnam.vn",
    ),
    FeaturedCompany(
        name="Vinasoy",
        homepage="https://vinasoy.com.vn",
        career_url="https://tuyendung.vinasoy.com.vn",
    ),
    FeaturedCompany(
        name="IKEA",
        homepage="https://ikea.com",
        career_url="https://jobs.ikea.com/en",
    ),
    FeaturedCompany(
        name="Decathlon",
        homepage="https://decathlon.com",
        career_url="https://careers.decathlon.com",
    ),
    FeaturedCompany(
        name="Adidas",
        homepage="https://adidas-group.com",
        career_url="https://careers.adidas-group.com",
    ),
    FeaturedCompany(
        name="Nike",
        homepage="https://nike.com",
        career_url="https://careers.nike.com",
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
        name="DB Schenker",
        homepage="https://dbschenker.com",
        career_url="https://careers.dbschenker.com",
    ),
    FeaturedCompany(
        name="Expeditors",
        homepage="https://expeditors.com",
        career_url="https://careers.expeditors.com",
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
        career_url="https://www.maersk.com/careers/vacancies?searchText=&city=",
    ),

    # ── International Banking ─────────────────────────────────────────
    FeaturedCompany(
        name="DBS",
        homepage="https://dbs.com",
        career_url="https://careers.dbs.com",
    ),
    FeaturedCompany(
        name="HSBC",
        homepage="https://hsbc.com",
        career_url="https://portal.careers.hsbc.com/careers?location=vietnam",
    ),
    FeaturedCompany(
        name="Standard Chartered",
        homepage="https://sc.com",
        career_url="https://jobs.standardchartered.com/Home?utm_source=careersite",
    ),
    FeaturedCompany(
        name="Citi",
        homepage="https://citibank.com",
        career_url="https://careers.citibank.com",
    ),
    FeaturedCompany(
        name="UOB",
        homepage="https://uobgroup.com",
        career_url="https://careers.uobgroup.com",
    ),
    FeaturedCompany(
        name="OCBC",
        homepage="https://ocbc.com",
        career_url="https://ocbc.wd102.myworkdayjobs.com/External",
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
        career_url="https://careers.manulife.com",
    ),
    FeaturedCompany(
        name="AIA",
        homepage="https://aia.com.vn",
        career_url="https://aia.wd3.myworkdayjobs.com/External",
    ),
    FeaturedCompany(
        name="Prudential",
        homepage="https://prudential.com.vn",
        career_url="https://careers.prudential.com",
    ),
    FeaturedCompany(
        name="Chubb",
        homepage="https://chubb.com",
        career_url="https://careers.chubb.com",
    ),
    FeaturedCompany(
        name="Bảo Việt",
        homepage="https://baoviet.com.vn",
        career_url="https://tuyendung.baoviet.com.vn",
    ),

    # ── Vingroup ──────────────────────────────────────────────────────
    FeaturedCompany(
        name="Vingroup",
        homepage="https://vingroup.net",
        career_url="https://careers.vingroup.net",
    ),
    FeaturedCompany(
        name="VinFast",
        homepage="https://vinfastauto.com",
        career_url="https://vinfastauto.com/vn_vi/co-hoi-nghe-nghiep",
    ),
    FeaturedCompany(
        name="Vinhomes",
        homepage="https://vinhomes.vn",
        career_url="https://careers.vinhomes.vn",
    ),
    FeaturedCompany(
        name="Vinschool",
        homepage="https://vinschool.edu.vn",
        career_url="https://careers.vinschool.edu.vn",
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
        career_url="https://www.samsungcareers.com.vn/#/jobs-list",
    ),
    FeaturedCompany(
        name="LG",
        homepage="https://lg.com",
        career_url="https://careers.lg.com",
    ),
    FeaturedCompany(
        name="Panasonic",
        homepage="https://panasonic.com",
        career_url="https://careers.panasonic.com",
    ),
    FeaturedCompany(
        name="Canon",
        homepage="https://canon.com",
        career_url="https://careers.canon.com",
    ),
    FeaturedCompany(
        name="Fujitsu",
        homepage="https://fujitsu.com",
        career_url="https://careers.fujitsu.com",
    ),
    FeaturedCompany(
        name="Hitachi",
        homepage="https://hitachi.com",
        career_url="https://careers.hitachi.com",
    ),
    FeaturedCompany(
        name="Sony",
        homepage="https://sony.com",
        career_url="https://careers.sony.com",
    ),

    # ── Semiconductor ─────────────────────────────────────────────────
    FeaturedCompany(
        name="Intel",
        homepage="https://intel.com",
        career_url="https://careers.intel.com",
    ),
    FeaturedCompany(
        name="Amkor Technology",
        homepage="https://amkor.com",
        career_url="https://careers.amkor.com",
    ),
    FeaturedCompany(
        name="Marvell",
        homepage="https://marvell.com",
        career_url="https://careers.marvell.com",
    ),
    FeaturedCompany(
        name="Infineon",
        homepage="https://infineon.com",
        career_url="https://careers.infineon.com",
    ),
    FeaturedCompany(
        name="NVIDIA",
        homepage="https://nvidia.com",
        career_url="https://careers.nvidia.com",
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
        career_url="https://careers.airliquide.com",
    ),
    FeaturedCompany(
        name="Siemens",
        homepage="https://siemens.com",
        career_url="https://careers.siemens.com",
    ),
    FeaturedCompany(
        name="Schneider Electric",
        homepage="https://schneider-electric.com",
        career_url="https://careers.schneider-electric.com",
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
        name="JTI",
        homepage="https://jti.com",
        career_url="https://careers.jti.com",
    ),
    FeaturedCompany(
        name="BAT",
        homepage="https://bat.com",
        career_url="https://careers.bat.com",
    ),
    FeaturedCompany(
        name="Philip Morris",
        homepage="https://pmi.com",
        career_url="https://careers.philipmorris.com",
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
        career_url="https://careers.hilton.com",
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
        career_url="https://careers.ihg.com",
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
        career_url="https://careers.microsoft.com",
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
)
