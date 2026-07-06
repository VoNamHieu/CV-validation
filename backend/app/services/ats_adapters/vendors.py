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


_ADAPTERS: list = [
    ("radancy",        lambda u, h: _is_radancy(u),      lambda u, h: _radancy(u)),
    ("avature",        _is_avature,                      lambda u, h: _avature(u, h)),
    ("amazon",         lambda u, h: _is_amazon(u),       lambda u, h: _amazon(u)),
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
    ("momo",           lambda u, h: _is_momo(u),         lambda u, h: _momo(u)),
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
    ("thegioididong",   lambda u, h: _is_thegioididong(u),   lambda u, h: _thegioididong(u)),
]
