# JobFit AI

> Powered by Gemini · No hallucination policy

## How It Works

```
╔══════════════════════════════════════════════════════════════════════╗
║                    JOBFIT AI — HOW IT WORKS                          ║
╚══════════════════════════════════════════════════════════════════════╝

┌──────────────────────────── WEB APP FLOW ────────────────────────────┐
│                                                                      │
│  ① UPLOAD CV          ② FIND JOBS         ③ REPORT          ④ EDIT   │
│  ┌──────────┐        ┌──────────┐       ┌──────────┐    ┌──────────┐ │
│  │ 📄 PDF   │───────▶│ 🌐 Job   │──────▶│ 📊 Score │───▶│ ✏️  Tailor│ │
│  │  Parse   │        │   URL    │       │  Match   │    │  & Export│ │
│  └────┬─────┘        └────┬─────┘       └────┬─────┘    └────┬─────┘ │
│       │                   │                  │               │       │
│       ▼                   ▼                  ▼               ▼       │
│   parse-pdf          crawl-url           ai/score        render-pdf  │
│   extract-cv         extract-jd          rank-jobs       optimize    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────── CHROME EXTENSION (AGENT) ──────────────────────┐
│                                                                      │
│              ┌─────────────── AGENTIC LOOP ──────────────┐           │
│              │                                           │           │
│              │   ┌─────────┐   ┌─────────┐  ┌─────────┐  │           │
│       ┌──────┼──▶│ OBSERVE │──▶│  PLAN   │─▶│   ACT   │──┼──┐        │
│       │      │   │ snapshot│   │  LLM    │  │ execute │  │  │        │
│       │      │   │   DOM   │   │ decides │  │ 1 step  │  │  │        │
│       │      │   └─────────┘   └─────────┘  └────┬────┘  │  │        │
│       │      │                                   │       │  │        │
│       │      └───────────────────────────────────┼───────┘  │        │
│       │                                          │          │        │
│       └────────────── repeat until DONE ◀────────┘          │        │
│                                                             │        │
│   Actions: fill · click · scroll · select · upload · wait ◀─┘        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

                    ┌──────────────── ARCHITECTURE ────────────────┐

                ┌──────────────────────────────────┐
                │      Frontend (Next.js)          │
                │   /api/ai/* · /api/crawl-url     │
                └──────────────┬───────────────────┘
                               │
                ┌──────────────┴───────────────────┐
                │                                  │
        ┌───────▼─────────┐             ┌──────────▼─────────┐
        │ Backend (FastAPI)│            │  Gemini LLM        │
        │  • pdf_parser   │             │  • CV/JD extract   │
        │  • crawler      │             │  • Form mapping    │
        │  • career_finder│             │  • Agent planner   │
        └─────────────────┘             └────────────────────┘
```

## Project Structure

- `frontend/` — Next.js web app (CV upload, job matching, report, CV editor)
- `backend/` — FastAPI services (PDF parsing, crawling, career finding)
- `extension/` — Chrome extension with agentic auto-filler
