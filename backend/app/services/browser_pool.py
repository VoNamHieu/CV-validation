"""
Playwright Browser Pool
Keeps one shared Chromium Browser alive per process. Each request creates
a fresh BrowserContext (~10–50 ms) instead of spawning a whole Chromium
(~200–500 ms), and avoids the memory churn of repeated launches.

Auto-recovers if the underlying browser dies (Chromium crash, OOM, etc.).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

_playwright: Optional[Any] = None
_browser: Optional[Any] = None
_lock = asyncio.Lock()

# Chromium flags tuned for server / container use.
LAUNCH_ARGS = [
    # /dev/shm is only 64 MB by default in Docker → Chromium can crash on
    # tab open without this. Forces /tmp instead.
    "--disable-dev-shm-usage",
    # Hide the most obvious automation fingerprint.
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--mute-audio",
]


async def get_browser() -> Any:
    """Return the shared Browser, launching it lazily on first use and
    re-launching if the previous instance died."""
    global _playwright, _browser
    async with _lock:
        if _browser is not None:
            try:
                if _browser.is_connected():
                    return _browser
            except Exception:
                pass  # treat as dead, fall through

        # Lazy import so module-level import doesn't require playwright
        # (e.g. in tests that mock the call).
        from playwright.async_api import async_playwright

        if _playwright is None:
            _playwright = await async_playwright().start()
            logger.info("[browser_pool] Playwright runtime started")

        _browser = await _playwright.chromium.launch(
            headless=True,
            args=LAUNCH_ARGS,
        )
        logger.info("[browser_pool] Chromium launched (singleton)")
        return _browser


async def close_browser() -> None:
    """Tear down on app shutdown — called from FastAPI lifespan."""
    global _playwright, _browser
    if _browser is not None:
        try:
            await _browser.close()
        except Exception as e:
            logger.warning(f"[browser_pool] browser close failed: {e}")
        _browser = None
    if _playwright is not None:
        try:
            await _playwright.stop()
        except Exception as e:
            logger.warning(f"[browser_pool] playwright stop failed: {e}")
        _playwright = None
