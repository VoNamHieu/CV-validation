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


# ── Rate Limiting Middleware (H2) ──
class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory IP-based rate limiter."""

    # Sweep idle buckets once the dict grows past this many keys.
    _SWEEP_AT = 10_000

    def __init__(self, app, max_requests: int = 30, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window_seconds
        self.clients: dict[str, list[float]] = defaultdict(list)

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

    async def dispatch(self, request: Request, call_next):
        key = self._client_key(request)
        now = time.time()
        stamps = [t for t in self.clients[key] if now - t < self.window]
        if len(stamps) >= self.max_requests:
            self.clients[key] = stamps
            return JSONResponse({"detail": "Too many requests. Please wait."}, status_code=429)
        stamps.append(now)
        self.clients[key] = stamps
        if len(self.clients) > self._SWEEP_AT:
            cutoff = now - self.window
            for k in [k for k, ts in self.clients.items() if not ts or ts[-1] < cutoff]:
                del self.clients[k]
        return await call_next(request)


app.add_middleware(RateLimitMiddleware, max_requests=30, window_seconds=60)

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
