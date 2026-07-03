# Copo DOM Research (internal extension)

An **internal-only** Chrome extension for reverse-engineering career pages. It
captures a page exactly as your logged-in browser renders it — full DOM, all
links/tables, embedded hydration state, **and the page's own XHR/fetch API calls
with response snippets** — and ships it to the backend `/debug/capture`. You then
ask Claude to read the capture and build/repair an ATS adapter from it.

> Not for the Chrome Web Store. Broad `<all_urls>` access + network sniffing are
> fine because it never leaves your machine/team. Do **not** publish it.

## What it captures (per page)

- `html` — `documentElement.outerHTML` of the fully-rendered page (≤3 MB)
- `apis` — every non-asset `fetch`/XHR the page made: `{method,url,status,reqBody,respSnippet}` — **this is how you find the hidden job API** (e.g. mokahr's `POST /api/outer/ats-apply/website/jobs/v2`)
- `anchors` — all `<a>` `{href,text}` (job-detail links)
- `tables` — table cell matrices
- `nextData` / `jsonld` / `state` — `__NEXT_DATA__`, JSON-LD, and embedded SPA state (`__NUXT__`/`__APOLLO_STATE__`/…)
- `extras` — framework fingerprint, iframes, open **shadow-DOM** text, `<meta>`, scripts, form count

## Install (once)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this `tools/research-extension/` folder.
2. Click the extension icon → **⚙️ Cấu hình backend**:
   - **Backend URL**: where FastAPI runs — `http://localhost:8000` for local dev, or the deployed backend URL.
   - **Debug token**: must equal `DEBUG_CAPTURE_TOKEN` in the backend `.env` (already set in this repo).
3. Save.

The backend route is off unless `DEBUG_CAPTURE_TOKEN` is set (it is here). It
must be reachable from your browser at the Backend URL above.

## Use

1. Open the career page you want to research. Interact if needed (search, next
   page, open a job) — the sniffer records API calls as they happen.
2. Click the extension → optional note → **📸 Capture trang đang mở**.
3. It reports host + sizes + #API calls, then tells you the exact phrase to hand
   Claude.

If it says the collector didn't respond, reload (F5) the page and retry
(content scripts don't inject into tabs that were already open when the
extension loaded/reloaded).

## Have Claude read it back

Just say: **"đọc capture host `<host>`"** (e.g. `đọc capture host careers.klook.com`).
Claude reads it via the backend with the debug token:

```bash
# newest capture for a host (full payload: html, apis, state, extras…)
curl -s -H "X-Debug-Token: $DEBUG_CAPTURE_TOKEN" \
  "$BACKEND_URL/debug/capture/latest?host=<host>"

# what's been captured recently
curl -s -H "X-Debug-Token: $DEBUG_CAPTURE_TOKEN" "$BACKEND_URL/debug/capture/list"
```

Captures live in Redis for 7 days. Claude focuses on `apis` (the job API +
response shape) and `state`/`nextData` to write the adapter in
`backend/app/services/ats_adapters/core.py`.
