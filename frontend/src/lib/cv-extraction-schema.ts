// Shared LLM extraction prompt + normalizer for CV parsing.
// Used by /api/parse-pdf (PDF input) and /api/ai/extract-cv (text input).

import type {
    CVData, ContactInfo, PersonalInfo, EmploymentInfo, JobPreferences,
    CertificationDetail, LanguageDetail, AwardDetail, ActivityDetail,
} from "@/lib/types";
import {
    EMPTY_CONTACT, EMPTY_PERSONAL, EMPTY_EMPLOYMENT, EMPTY_PREFERENCES,
} from "@/lib/types";

export const CV_EXTRACTION_SYSTEM_PROMPT = `You are an intelligent CV parser. Extract accurate and structured data.
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}],
  "certifications": [{"name": "string", "issuer": "string", "year": "string"}],
  "languages": [{"language": "string", "level": "string (e.g., IELTS 7.0, TOEIC 800, Native, Fluent, Intermediate)"}],
  "awards": [{"title": "string", "year": "string"}],
  "activities": [{"name": "string", "description": "string"}],
  "contact": {
    "email": "string",
    "phone": "string",
    "address_province": "string",
    "address_district": "string",
    "address_street": "string",
    "linkedin": "string",
    "github": "string",
    "portfolio": "string"
  },
  "personal": {
    "date_of_birth": "string (ISO YYYY-MM-DD if known)",
    "gender": "string",
    "nationality": "string",
    "marital_status": "string"
  },
  "employment": {
    "current_title": "string",
    "current_company": "string",
    "current_level": "string (e.g., Junior, Mid, Senior, Lead)",
    "current_industry": "string",
    "current_fields": "string (functional area, e.g., Backend, Data, Product)",
    "current_salary": "string",
    "years_of_experience": number,
    "highest_degree": "string"
  },
  "preferences": {
    "desired_locations": "string",
    "desired_salary": "string"
  }
}

Rules:
- COMPLETENESS IS CRITICAL: this output replaces the original CV, so any detail you omit is lost forever. Extract EVERY section and EVERY line of the CV into the schema.
- For experience[].description, projects[].description, and activities[].description: copy EVERY bullet point and sentence from the source, keeping the original wording (translate nothing, summarize nothing). Output each bullet on its own line, separated by "\\n", without leading "-" or "*" characters. NEVER shorten, merge, drop, or paraphrase bullets — the bullet count in your output must equal the bullet count in the CV.
- Map CV sections to schema fields: "Certifications" / "Chứng chỉ" / courses → certifications; "Languages" / "Ngoại ngữ" → languages; "Awards" / "Honors" / "Giải thưởng" / "Danh hiệu" → awards; "Activities" / "Volunteering" / "Hoạt động" / "Tình nguyện" / extracurriculars → activities.
- If the CV contains content that fits no schema field (e.g., interests, references, publications), append it as extra lines to the most closely related description field rather than dropping it — e.g., publications under the related experience or activities entry.
- Extract contact info (email, phone, address, LinkedIn, GitHub, portfolio URL) from anywhere in the CV — usually the header.
- If the address looks Vietnamese (e.g., contains "Quan", "Huyen", "Phuong", "Tinh", "TP", "Ha Noi", "Ho Chi Minh", "Da Nang", or similar), split it into address_province / address_district / address_street. Otherwise put the city or region in address_province and leave the rest empty.
- Set employment.current_title and employment.current_company from the most-recent experience entry (the one marked "Present" / current, or the topmost if dates indicate it is ongoing).
- Compute employment.years_of_experience by summing experience[].duration_months / 12 and rounding to the nearest integer.
- Set employment.highest_degree from the highest-ranked education entry (PhD > Master > Bachelor > Diploma > High School). Use the value verbatim from the CV.
- Only fill date_of_birth, gender, nationality, marital_status, current_level, current_industry, current_fields, current_salary, desired_locations, desired_salary if they appear explicitly in the CV. Otherwise leave them as empty strings.
- NEVER invent or guess values. Empty string is always preferable to a hallucinated value.
- For arrays where no data exists, return [].`;

type Raw = Record<string, unknown> | null | undefined;

function asString(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function normalizeContact(raw: Raw): ContactInfo {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
        ...EMPTY_CONTACT,
        email: asString(r.email),
        phone: asString(r.phone),
        address_province: asString(r.address_province),
        address_district: asString(r.address_district),
        address_street: asString(r.address_street),
        linkedin: asString(r.linkedin),
        github: asString(r.github),
        portfolio: asString(r.portfolio),
    };
}

function normalizePersonal(raw: Raw): PersonalInfo {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
        ...EMPTY_PERSONAL,
        date_of_birth: asString(r.date_of_birth),
        gender: asString(r.gender),
        nationality: asString(r.nationality),
        marital_status: asString(r.marital_status),
    };
}

function normalizeEmployment(raw: Raw, experienceCount: number): EmploymentInfo {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
        ...EMPTY_EMPLOYMENT,
        current_title: asString(r.current_title),
        current_company: asString(r.current_company),
        current_level: asString(r.current_level),
        current_industry: asString(r.current_industry),
        current_fields: asString(r.current_fields),
        current_salary: asString(r.current_salary),
        years_of_experience: asNumber(r.years_of_experience) || experienceCount,
        highest_degree: asString(r.highest_degree),
    };
}

function asObjectArray(v: unknown): Record<string, unknown>[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

function normalizeCertifications(raw: unknown): CertificationDetail[] {
    return asObjectArray(raw)
        .map(r => ({ name: asString(r.name), issuer: asString(r.issuer), year: asString(r.year) }))
        .filter(c => c.name);
}

function normalizeLanguages(raw: unknown): LanguageDetail[] {
    return asObjectArray(raw)
        .map(r => ({ language: asString(r.language), level: asString(r.level) }))
        .filter(l => l.language);
}

function normalizeAwards(raw: unknown): AwardDetail[] {
    return asObjectArray(raw)
        .map(r => ({ title: asString(r.title), year: asString(r.year) }))
        .filter(a => a.title);
}

function normalizeActivities(raw: unknown): ActivityDetail[] {
    return asObjectArray(raw)
        .map(r => ({ name: asString(r.name), description: asString(r.description) }))
        .filter(a => a.name || a.description);
}

function normalizePreferences(raw: Raw): JobPreferences {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
        ...EMPTY_PREFERENCES,
        desired_locations: asString(r.desired_locations),
        desired_salary: asString(r.desired_salary),
    };
}

// Coerce whatever the LLM returns into a fully-populated CVData with all
// sub-objects present. Tolerates older response shapes that omit the new
// sub-objects entirely.
export function normalizeCVResponse(parsed: unknown): CVData {
    const r = (parsed ?? {}) as Record<string, unknown>;
    const experience = Array.isArray(r.experience) ? r.experience : [];
    return {
        name: asString(r.name),
        summary: asString(r.summary),
        skills: Array.isArray(r.skills) ? (r.skills as string[]).filter(s => typeof s === "string") : [],
        experience: experience as CVData["experience"],
        education: Array.isArray(r.education) ? (r.education as CVData["education"]) : [],
        projects: Array.isArray(r.projects) ? (r.projects as CVData["projects"]) : [],
        certifications: normalizeCertifications(r.certifications),
        languages: normalizeLanguages(r.languages),
        awards: normalizeAwards(r.awards),
        activities: normalizeActivities(r.activities),
        contact: normalizeContact(r.contact as Raw),
        personal: normalizePersonal(r.personal as Raw),
        employment: normalizeEmployment(r.employment as Raw, experience.length),
        preferences: normalizePreferences(r.preferences as Raw),
    };
}
