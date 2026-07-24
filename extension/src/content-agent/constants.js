// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
// ─── Config ───
export const AGENT_MAX_ITERATIONS = 25;

export const SCROLL_STEP_PX = 600;

export const SCROLL_PAUSE_MS = 300;

export const POST_ACTION_WAIT_MS = 1000;

export const LLM_TIMEOUT = 125000;  // backstop; the background fetch's own 120s timeout fires first
// (Application Questions sends a big prompt — 14 long legal questions — so the
//  thinking model can take >60s; give it room instead of failing the apply.)

export const JOB_PAGE_DETECT_TIMEOUT_MS = 8000;

export const JOB_PAGE_DETECT_POLL_MS = 600;

export const FILL_RETRY_THRESHOLD = 2; // After N failed fill attempts on same selector → mark persistently unfilled

// URL keywords that strongly hint at a job/apply page
export const JOB_URL_KEYWORDS = [
    'apply', 'application', 'job', 'jobs', 'career', 'careers', 'hiring',
    'recruit', 'vacancy', 'position', 'opening',
    'viec-lam', 'tuyen-dung', 'ung-tuyen', 'tim-viec',
    'workday', 'greenhouse', 'lever.co', 'ashbyhq', 'smartrecruiters',
    'icims', 'taleo', 'jobvite', 'breezy', 'bamboohr',
];

// Apply-button text (en + vi)
export const APPLY_BUTTON_TEXTS = [
    'apply now', 'apply', 'easy apply', 'quick apply', 'submit application',
    'ứng tuyển', 'nộp đơn', 'nộp hồ sơ', 'ứng tuyển ngay',
];

// Hosts where the agent must never appear. Social / search / media / mail
// sites routinely render multi-input login, signup, and search forms that
// falsely trip the job-page heuristics (this is why the button showed up on
// Instagram). Real job sites (LinkedIn, etc.) are deliberately NOT listed.
export const DENY_HOST_SUFFIXES = [
    'instagram.com', 'facebook.com', 'fb.com', 'messenger.com', 'whatsapp.com',
    'twitter.com', 'x.com', 'threads.net', 'tiktok.com', 'reddit.com',
    'pinterest.com', 'snapchat.com', 'youtube.com', 'netflix.com', 'twitch.tv',
    'spotify.com', 'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
    'gmail.com', 'outlook.com', 'telegram.org', 'discord.com',
];

// Words that confirm a page is really about a job/application. Used to validate
// a form-only match — a bare login/contact/search form is not enough on its own.
export const JOB_CONTEXT_KEYWORDS = [
    'job', 'career', 'vacancy', 'position', 'recruit', 'hiring', 'employment',
    'apply', 'application', 'resume', 'cover letter',
    'tuyển dụng', 'việc làm', 'ứng tuyển', 'vị trí', 'tuyển',
];

// A pendingAutoApply flag older than this is stale (e.g. the apply tab closed
// before reporting) — do NOT let it auto-fire on some unrelated job page the
// user opens later. The background clears it on result / tab-close, but this is
// the content-side backstop.
export const APPLY_SESSION_TTL_MS = 10 * 60 * 1000;
