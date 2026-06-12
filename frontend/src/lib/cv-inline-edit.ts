// Write-back logic for inline editing on the rendered CV template preview.
//
// Templates mark editable elements with data-f="<path>" (see cv-templates/*).
// The preview iframe turns those elements contentEditable; on blur the edited
// innerText is applied back onto CVData here. Paths mirror the CVData shape
// ("name", "experience.0.title", "skills.2") plus two composite pseudo-fields
// that templates render as a single string:
//   - "experience.N.daterange"  → "01/2022 – Hiện tại" → start_date/end_date
//   - "languages.N"             → "English — IELTS 7.0" → language/level

import type { CVData } from "@/lib/types";

function cloneCv(cv: CVData): CVData {
    return JSON.parse(JSON.stringify(cv)) as CVData;
}

// Bullet containers (ul/li) produce one line per bullet in innerText; plain
// fields may pick up stray newlines from contentEditable. Normalize both.
function cleanLines(text: string): string {
    return text
        .split("\n")
        .map(l => l.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean)
        .join("\n");
}

function cleanSingle(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

// "01/2022 – Hiện tại" → {start, end}. Accepts en dash, em dash, or a
// hyphen surrounded by spaces (so "2021-2023" still splits but a date like
// "01-2022" alone does not).
function parseDateRange(text: string): { start: string; end: string } | null {
    const t = cleanSingle(text);
    if (!t) return { start: "", end: "" };
    const parts = t.split(/\s*[–—]\s*|\s+-\s+/);
    if (parts.length === 2) return { start: parts[0].trim(), end: parts[1].trim() };
    if (parts.length === 1) return { start: parts[0].trim(), end: "" };
    return null; // ambiguous — leave the field unchanged
}

function parseLanguage(text: string): { language: string; level: string } {
    const t = cleanSingle(text);
    const parts = t.split(/\s*[–—]\s*|\s+-\s+/);
    if (parts.length >= 2) {
        return { language: parts[0].trim(), level: parts.slice(1).join(" - ").trim() };
    }
    return { language: t, level: "" };
}

type Rec = Record<string, unknown>;

/**
 * Apply one inline edit to a CVData immutably. Unknown or out-of-range paths
 * return the CV unchanged — a stale preview must never corrupt the data.
 */
export function applyCvFieldEdit(cv: CVData, path: string, rawText: string): CVData {
    const segments = path.split(".");
    const next = cloneCv(cv);

    // ── Composites ──
    if (segments[0] === "experience" && segments[2] === "daterange" && segments.length === 3) {
        const idx = Number(segments[1]);
        const entry = next.experience?.[idx];
        if (!entry) return cv;
        const range = parseDateRange(rawText);
        if (!range) return cv;
        entry.start_date = range.start;
        entry.end_date = range.end;
        return next;
    }
    if (segments[0] === "languages" && segments.length === 2) {
        const idx = Number(segments[1]);
        if (!next.languages?.[idx]) return cv;
        next.languages[idx] = parseLanguage(rawText);
        return next;
    }
    if (segments[0] === "skills" && segments.length === 2) {
        const idx = Number(segments[1]);
        if (!next.skills || next.skills[idx] === undefined) return cv;
        const value = cleanSingle(rawText);
        if (value) next.skills[idx] = value;
        else next.skills.splice(idx, 1); // cleared chip = remove the skill
        return next;
    }

    // ── Generic dotted path walk ──
    const isMultiline = segments[segments.length - 1] === "description"
        || segments[segments.length - 1] === "summary";
    const value = isMultiline ? cleanLines(rawText) : cleanSingle(rawText);

    let target: unknown = next;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (Array.isArray(target)) {
            target = target[Number(seg)];
        } else if (target && typeof target === "object") {
            target = (target as Rec)[seg];
        } else {
            return cv;
        }
        if (target === undefined || target === null) return cv;
    }

    const last = segments[segments.length - 1];
    if (Array.isArray(target)) {
        const idx = Number(last);
        if (Number.isNaN(idx) || target[idx] === undefined) return cv;
        target[idx] = value;
    } else if (target && typeof target === "object") {
        const t = target as Rec;
        if (typeof t[last] === "number") {
            const n = Number(value);
            if (!Number.isFinite(n)) return cv;
            t[last] = n;
        } else {
            t[last] = value;
        }
    } else {
        return cv;
    }
    return next;
}
