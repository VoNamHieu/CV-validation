import ipaddress
import logging
import os
import sys
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # Load env vars before router imports

# ── Logging: force the `app.*` tree to INFO with its own stdout handler ──
# Don't rely on logging.basicConfig (a no-op once uvicorn/gunicorn has attached
# a root handler → our [facet]/[featured]/[search] INFO lines get swallowed).
# Configure the "app" logger tree directly so INFO reliably reaches Railway
# stdout, regardless of what the server did to the root logger. LOG_LEVEL env
# overrides (e.g. WARNING to quiet it).
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
_app_logger = logging.getLogger("app")
_app_logger.setLevel(_LOG_LEVEL)
if not any(isinstance(h, logging.StreamHandler) for h in _app_logger.handlers):
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    _app_logger.addHandler(_h)
_app_logger.propagate = False  # own handler → don't double-log via root

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.routers import (
    extract, crawl, smart_crawl, render, career, debug_capture, link_monitor,
    compat_monitor, store, account, credits, admin, feedback, events, interview,
    incidents, webhooks,
)
from app.services.browser_pool import close_browser
from app.db.pool import close_pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the featured-jobs cache out-of-band at startup so the 150-page crawl
    # never has to finish inside a user request (which was timing out → 500).
    # awaits only a fast cache check; the crawl itself runs in the background.
    await career.warm_featured_cache()
    # Browser is launched lazily on first use (see browser_pool.get_browser);
    # only need to clean it up on shutdown. The DB pool is likewise lazy
    # (first get_pool() call) — just close it on shutdown.
    yield
    await close_browser()
    await close_pool()


app = FastAPI(title="AI Job Fit Optimizer API", version="1.0.0", lifespan=lifespan)


# ── Global exception handler → incident log (system / DB errors) ──
# FastAPI handles HTTPException (4xx) via its own handler, so this only catches
# UNhandled exceptions that would otherwise become an opaque 500. We log the
# traceback (existing behaviour) AND record an incident, classifying asyncpg
# failures as db_error, then return the same generic 500 as before. Recording
# is fire-and-forget (services.incidents.report never raises).
@app.exception_handler(Exception)
async def _log_unhandled(request: Request, exc: Exception):
    import asyncpg
    from app.services import incidents as incidents_svc

    _app_logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    kind = "db_error" if isinstance(exc, asyncpg.PostgresError) else "system_error"
    await incidents_svc.report(
        kind,
        module=request.url.path,
        error=exc,
        context={"method": request.method, "path": request.url.path},
    )
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


# ── Rate Limiting Middleware (H2) ──
class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory per-caller rate limiter.

    The caller key is the **verified** JWT ``sub`` when a valid bearer token is
    present, else the client IP. Keying authenticated traffic on the user (not
    the IP) is essential behind the Vercel→Railway proxy: the browser never hits
    Railway directly, so every user's request arrives from one of a few Vercel
    egress IPs. Pure IP-keying collapsed the WHOLE product into a single
    per-egress-IP bucket, so one busy user (or the extension) could 429 everyone
    else — the intermittent "Không kiểm tra được quyền" on /admin. Per-user
    buckets are also egress-IP- and NAT-proof, and can't be gamed: the sub is
    signature-verified, so a caller can't mint fake identities to get extra
    buckets (an unverified/invalid token falls back to the IP bucket).

    Two caps: ``user_max`` per authenticated user, and a higher ``ip_max`` for
    the IP bucket — that bucket is *shared* by every anonymous visitor behind an
    egress IP, so it must be far larger than a single user's budget."""

    # Sweep idle buckets once the dict grows past this many keys.
    _SWEEP_AT = 10_000
    # Re-verify a given bearer token at most this often (signature check + the
    # occasional JWKS fetch are amortised across a token's ~1h life). Caches the
    # None result too, so a repeated garbage token isn't re-verified each hit.
    _TOKEN_TTL = 300

    def __init__(self, app, user_max: int = 60, ip_max: int = 600, window_seconds: int = 60):
        super().__init__(app)
        self.user_max = user_max
        self.ip_max = ip_max
        self.window = window_seconds
        self.clients: dict[str, list[float]] = defaultdict(list)
        # token -> (verified_sub_or_None, cached_at)
        self._token_subs: dict[str, tuple[str | None, float]] = {}

    # How many trusted proxy hops sit in front of the app. The real client IP
    # is the Nth-from-last X-Forwarded-For entry. Default 1 = the single hop
    # the trusted edge (Railway) appends. Set TRUSTED_PROXY_HOPS to match the
    # actual chain if a CDN sits in front (e.g. Cloudflare→Railway = 2), so the
    # key can't be pinned to a client-supplied hop.
    _TRUSTED_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))

    @classmethod
    def _client_key(cls, request: Request) -> str:
        # Behind the Railway edge, request.client.host is the proxy for ALL
        # external traffic — keying on it collapses every user into one shared
        # bucket. Trust only the hop the edge appended; earlier hops are
        # client-supplied and spoofable.
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            if parts:
                idx = len(parts) - cls._TRUSTED_HOPS
                return parts[idx] if idx >= 0 else parts[0]
        return request.client.host if request.client else "unknown"

    def _verified_sub(self, token: str) -> str | None:
        """Verified JWT ``sub`` for a bearer token, cached ``_TOKEN_TTL`` seconds
        (positive AND negative) so the hot path doesn't re-verify every request."""
        now = time.time()
        cached = self._token_subs.get(token)
        if cached and now - cached[1] < self._TOKEN_TTL:
            return cached[0]
        from app.services.auth import verify_bearer_sub  # lazy — avoid import cycle
        sub = verify_bearer_sub(token)
        self._token_subs[token] = (sub, now)
        if len(self._token_subs) > self._SWEEP_AT:
            for k in [k for k, (_, ts) in self._token_subs.items() if now - ts >= self._TOKEN_TTL]:
                del self._token_subs[k]
        return sub

    def _identity(self, request: Request, client_ip: str) -> tuple[str, int]:
        """(bucket key, its cap). Authenticated → per-user bucket; else IP."""
        auth = request.headers.get("authorization", "")
        if auth[:7].lower() == "bearer ":
            sub = self._verified_sub(auth[7:].strip())
            if sub:
                return f"u:{sub}", self.user_max
        return f"ip:{client_ip}", self.ip_max

    @staticmethod
    def _is_exempt(key: str) -> bool:
        """Never throttle loopback/private clients. Behind the Railway edge the
        client key is the real forwarded public IP, so a loopback/private key
        only shows up when there's no edge in front — i.e. LOCAL DEV, where the
        Next dev-server proxy and every API call all originate from 127.0.0.1 and
        would otherwise collapse into ONE 30-req/min bucket. A single /admin load
        fans out to /me + /credits/balance + /admin/check + /store/... + a burst
        of /events, instantly tripping the cap and 429-ing /admin/check — which
        the UI reads as 'Không kiểm tra được quyền'. Exempting private space
        fixes dev with zero effect on the public abuse guard."""
        try:
            addr = ipaddress.ip_address(key)
        except ValueError:
            return False
        return addr.is_loopback or addr.is_private

    async def dispatch(self, request: Request, call_next):
        client_ip = self._client_key(request)
        if self._is_exempt(client_ip):
            return await call_next(request)
        key, limit = self._identity(request, client_ip)
        now = time.time()
        stamps = [t for t in self.clients[key] if now - t < self.window]
        if len(stamps) >= limit:
            self.clients[key] = stamps
            # Tell the client when the window frees up, so it backs off instead
            # of hammering (the admin check retried 4× inside the same window).
            retry_after = max(1, int(self.window - (now - stamps[0])))
            return JSONResponse(
                {"detail": "Too many requests. Please wait."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        stamps.append(now)
        self.clients[key] = stamps
        if len(self.clients) > self._SWEEP_AT:
            cutoff = now - self.window
            for k in [k for k, ts in self.clients.items() if not ts or ts[-1] < cutoff]:
                del self.clients[k]
        return await call_next(request)


# Caps are env-tunable so ops can raise them without a code change.
# RATE_LIMIT_MAX = per authenticated user (60/min covers a heavy dashboard
# load — a dozen+ calls — with headroom). RATE_LIMIT_IP_MAX = the anonymous IP
# bucket, which behind the Vercel egress is shared by ALL logged-out visitors,
# so it's set much higher. Loopback/private clients (local dev) are exempt
# entirely — see RateLimitMiddleware._is_exempt.
app.add_middleware(
    RateLimitMiddleware,
    user_max=int(os.getenv("RATE_LIMIT_MAX", "60")),
    ip_max=int(os.getenv("RATE_LIMIT_IP_MAX", "600")),
    window_seconds=int(os.getenv("RATE_LIMIT_WINDOW", "60")),
)

# ── CORS — use explicit origin whitelist instead of wildcard (B2) ──
allowed_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "AI Job Fit Optimizer Backend is running"}


@app.get("/health")
def health_check():
    """Dedicated health endpoint for Railway / load balancers (L1)."""
    return {"status": "ok", "service": "ai-job-fit-optimizer"}


@app.get("/health/db")
async def health_db():
    """Connectivity probe for the Supabase Postgres pool."""
    from app.db.pool import ping
    try:
        ok = await ping()
        return {"status": "ok" if ok else "degraded", "db": "supabase-postgres"}
    except Exception as e:  # noqa: BLE001 — surface the reason to the caller
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)


app.include_router(extract.router)
app.include_router(crawl.router)
app.include_router(smart_crawl.router)
app.include_router(render.router)
app.include_router(career.router)
app.include_router(debug_capture.router)
app.include_router(link_monitor.router)
app.include_router(compat_monitor.router)
app.include_router(store.router)
app.include_router(account.router)
app.include_router(credits.router)
app.include_router(admin.router)
app.include_router(feedback.router)
app.include_router(events.router)
app.include_router(interview.router)
app.include_router(incidents.router)
app.include_router(webhooks.router)
