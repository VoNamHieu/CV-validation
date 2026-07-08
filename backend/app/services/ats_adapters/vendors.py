"""The `_ADAPTERS` registry — wires every adapter into the dispatch order.

Adapter implementations live in sibling modules (imported via * below):
  - platforms.py : multi-tenant / global ATS engines (Workday, SuccessFactors,
    Eightfold, Phenom, Oracle HCM, Radancy, mokahr, base.vn, …)
  - vn.py        : single Vietnam-company adapters (TCBS, MoMo, VNPAY, Be, Zalo, …)
  - one-off modules (e.g. vpbanks.py, viettelhightech.py) : a single-company
    adapter that outgrew a drive-by addition to vn.py — give it its own file
    instead of growing vn.py further.

To add an adapter: write `_is_x` / `_x` in platforms.py, vn.py, or its own module,
then append one line to `_ADAPTERS` here (the only shared edit point) and import
the module below. Shared helpers: `._shared`.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

from app.services.ats_adapters.platforms import *  # noqa: F401,F403
from app.services.ats_adapters.vn import *  # noqa: F401,F403
from app.services.ats_adapters.vpbanks import *  # noqa: F401,F403
from app.services.ats_adapters.viettelhightech import *  # noqa: F401,F403
from app.services.ats_adapters.vnpt import *  # noqa: F401,F403
from app.services.ats_adapters.thegioididong import *  # noqa: F401,F403
from app.services.ats_adapters.cellphones import *  # noqa: F401,F403
from app.services.ats_adapters.vnptai import *  # noqa: F401,F403
from app.services.ats_adapters.aeon import *  # noqa: F401,F403
from app.services.ats_adapters.maisonrmi import *  # noqa: F401,F403
from app.services.ats_adapters.concung import *  # noqa: F401,F403
from app.services.ats_adapters.homecredit import *  # noqa: F401,F403
from app.services.ats_adapters.doji import *  # noqa: F401,F403
from app.services.ats_adapters.chailease import *  # noqa: F401,F403
from app.services.ats_adapters.mitek import *  # noqa: F401,F403
from app.services.ats_adapters.everfit import *  # noqa: F401,F403
from app.services.ats_adapters.bitis import *  # noqa: F401,F403
from app.services.ats_adapters.vng import *  # noqa: F401,F403
from app.services.ats_adapters.honda import *  # noqa: F401,F403
from app.services.ats_adapters.mmvietnam import *  # noqa: F401,F403
from app.services.ats_adapters.fecredit import *  # noqa: F401,F403
from app.services.ats_adapters.cmctelecom import *  # noqa: F401,F403
from app.services.ats_adapters.deheus import *  # noqa: F401,F403
from app.services.ats_adapters.viettelidc import *  # noqa: F401,F403
from app.services.ats_adapters.guardian import *  # noqa: F401,F403
from app.services.ats_adapters.f88 import *  # noqa: F401,F403
from app.services.ats_adapters.fpts import *  # noqa: F401,F403
from app.services.ats_adapters.seabank import *  # noqa: F401,F403
from app.services.ats_adapters.unilever import *  # noqa: F401,F403
from app.services.ats_adapters.tasco import *  # noqa: F401,F403


_ADAPTERS: list = [
    ("radancy",        lambda u, h: _is_radancy(u),      lambda u, h: _radancy(u)),
    ("avature",        _is_avature,                      lambda u, h: _avature(u, h)),
    ("amazon",         lambda u, h: _is_amazon(u),       lambda u, h: _amazon(u)),
    # MiTek's VN-dedicated Workday tenant — must precede the generic `workday`
    # adapter, whose searchText="Vietnam" filter under-counts this all-VN board.
    ("mitek",          lambda u, h: _is_mitek(u),        lambda u, h: _mitek(u)),
    ("workday",        lambda u, h: _resolve_workday_url(u, h) is not None,
                       lambda u, h: _workday(_resolve_workday_url(u, h))),
    ("base.vn",        _is_basevn,                       lambda u, h: _basevn(u, h)),
    ("workatsea",      _is_workatsea,                    lambda u, h: _workatsea(u)),
    ("mokahr",         lambda u, h: _is_mokahr(u),       lambda u, h: _mokahr(u)),
    ("oracle-hcm",     lambda u, h: _is_oracle_hcm(u),   lambda u, h: _oracle_hcm(u)),
    ("bytedance",      lambda u, h: bool(_bd_config(u)), lambda u, h: _bytedance_family(u)),
    ("vpbanks",        lambda u, h: _is_vpbanks(u),      lambda u, h: _vpbanks(u)),
    ("mbbank",         lambda u, h: _is_mbbank(u),       lambda u, h: _mbbank(u)),
    ("tcbs",           lambda u, h: _is_tcbs(u),         lambda u, h: _tcbs(u)),
    ("canon",          lambda u, h: _is_canon(u),        lambda u, h: _canon(u)),
    ("momo",           lambda u, h: _is_momo(u),         lambda u, h: _momo(u, h)),
    ("vnpay",          lambda u, h: _is_vnpay_tuyendung(u), lambda u, h: _vnpay_tuyendung(u)),
    ("be",             lambda u, h: _is_be(u),           lambda u, h: _be(u)),
    ("zalo",           lambda u, h: _is_zalo(u),         lambda u, h: _zalo(u)),
    ("iviec",          lambda u, h: _is_iviec(u, h),     lambda u, h: _iviec(u)),
    ("ghn",            lambda u, h: _is_ghn(u),          lambda u, h: _ghn(u)),
    ("trustingsocial", lambda u, h: _is_trustingsocial(u), lambda u, h: _trustingsocial(u)),
    ("careers-page",   lambda u, h: _is_careerspage(u),    lambda u, h: _careerspage(u)),
    ("timo",           lambda u, h: _is_timo(u),           lambda u, h: _timo(u)),
    ("geekadventure",  lambda u, h: _is_geekadventure(u),  lambda u, h: _geekadventure(u)),
    ("garena",         lambda u, h: _is_garena(u),         lambda u, h: _garena(u)),
    ("talentnet",      lambda u, h: _is_talentnet(u),      lambda u, h: _talentnet(u)),
    ("ssi",            lambda u, h: _is_ssi(u),            lambda u, h: _ssi(u)),
    ("appota",         lambda u, h: _is_appota(u),         lambda u, h: _appota(u)),
    ("vinacapital",    lambda u, h: _is_vinacapital(u),    lambda u, h: _vinacapital(u, h)),
    ("ahamove",        _is_ahamove,                      lambda u, h: _ahamove(u)),
    ("fptsoft",        _is_fptsoft,                      lambda u, h: _fptsoft(u)),
    ("phenom-v2",      _is_phenom_v2,                    lambda u, h: _phenom_v2(u)),
    ("odoo",           _is_odoo_jobs,                    lambda u, h: _odoo_jobs(u, h)),
    ("phenom",         lambda u, h: _is_phenom_services(u), lambda u, h: _phenom_services(u)),
    ("eightfold",      _is_eightfold,                    lambda u, h: _eightfold(u)),
    ("successfactors", _is_successfactors,               lambda u, h: _successfactors(u, h)),
    ("viettelhightech", lambda u, h: _is_viettelhightech(u), lambda u, h: _viettelhightech(u)),
    ("vnpt",            lambda u, h: _is_vnpt(u),            lambda u, h: _vnpt(u)),
    ("thegioididong",   lambda u, h: _is_thegioididong(u),   lambda u, h: _thegioididong(u, h)),
    ("cellphones",      lambda u, h: _is_cellphones(u),      lambda u, h: _cellphones(u)),
    ("vnptai",          lambda u, h: _is_vnptai(u),          lambda u, h: _vnptai(u)),
    ("aeon",            lambda u, h: _is_aeon(u),            lambda u, h: _aeon(u)),
    ("maisonrmi",       lambda u, h: _is_maisonrmi(u),       lambda u, h: _maisonrmi(u)),
    ("concung",         lambda u, h: _is_concung(u),         lambda u, h: _concung(u)),
    ("homecredit",      lambda u, h: _is_homecredit(u),      lambda u, h: _homecredit(u)),
    ("doji",            lambda u, h: _is_doji(u),            lambda u, h: _doji(u)),
    ("chailease",       lambda u, h: _is_chailease(u),       lambda u, h: _chailease(u)),
    ("everfit",         lambda u, h: _is_everfit(u),         lambda u, h: _everfit(u)),
    ("bitis",           lambda u, h: _is_bitis(u),           lambda u, h: _bitis(u)),
    ("vng",             lambda u, h: _is_vng(u),             lambda u, h: _vng(u)),
    ("honda",           lambda u, h: _is_honda(u),           lambda u, h: _honda(u)),
    ("mmvietnam",       lambda u, h: _is_mmvietnam(u),       lambda u, h: _mmvietnam(u)),
    ("fecredit",        lambda u, h: _is_fecredit(u),        lambda u, h: _fecredit(u)),
    ("cmctelecom",      lambda u, h: _is_cmctelecom(u),      lambda u, h: _cmctelecom(u)),
    ("deheus",          lambda u, h: _is_deheus(u),          lambda u, h: _deheus(u)),
    ("viettelidc",      lambda u, h: _is_viettelidc(u),      lambda u, h: _viettelidc(u)),
    ("guardian",        lambda u, h: _is_guardian(u),        lambda u, h: _guardian(u)),
    ("f88",             lambda u, h: _is_f88(u),             lambda u, h: _f88(u)),
    ("fpts",            lambda u, h: _is_fpts(u),            lambda u, h: _fpts(u)),
    ("seabank",         lambda u, h: _is_seabank(u),         lambda u, h: _seabank(u)),
    ("unilever",        lambda u, h: _is_unilever(u),        lambda u, h: _unilever(u)),
    ("tasco",           lambda u, h: _is_tasco(u),           lambda u, h: _tasco(u)),
]
