import os
import time
from collections import defaultdict

from dotenv import load_dotenv
load_dotenv()  # Load env vars before router imports

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.routers import extract, crawl, smart_crawl

app = FastAPI(title="AI Job Fit Optimizer API", version="1.0.0")


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


app.include_router(extract.router)
app.include_router(crawl.router)
app.include_router(smart_crawl.router)
