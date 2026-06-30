import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # Load env vars before router imports

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.routers import (
    extract, crawl, smart_crawl, render, career, debug_capture, link_monitor,
    compat_monitor, store, account, credits, admin,
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

    def __init__(self, app, max_requests: int = 30, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window_seconds
        self.clients: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        # Clean expired timestamps
        self.clients[client_ip] = [t for t in self.clients[client_ip] if now - t < self.window]
        if len(self.clients[client_ip]) >= self.max_requests:
            return JSONResponse({"detail": "Too many requests. Please wait."}, status_code=429)
        self.clients[client_ip].append(now)
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
