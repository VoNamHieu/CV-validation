// Shared type definitions matching the Pydantic schemas from the backend

export interface ExperienceDetail {
    title: string;
    company: string;
    duration_months: number;
    // Verbatim dates from the CV (e.g., "03/2021", "Jan 2021", "Hiện tại").
    // Optional so CVData persisted before these fields existed still type-checks.
    start_date?: string;
    end_date?: string;
    description: string;
}

export interface EducationDetail {
    degree: string;
    institution: string;
    year: string;
    /** Optional: several ATS ask for it as a REQUIRED field (Workday's "Overall
     *  Result (GPA)"), and no résumé parse can supply it — only the candidate
     *  knows. Optional so CVs saved before this existed still type-check. */
    gpa?: string;
}

export interface ProjectDetail {
    name: string;
    description: string;
}

export interface CertificationDetail {
    name: string;
    issuer: string;
    year: string;
}

export interface LanguageDetail {
    language: string;
    level: string;
}

export interface AwardDetail {
    title: string;
    year: string;
}

export interface ActivityDetail {
    name: string;
    description: string;
}

export interface ContactInfo {
    email: string;
    phone: string;
    address_province: string;
    address_district: string;
    address_street: string;
    /** Required by several international ATS and never present on a CV. */
    address_postal_code?: string;
    linkedin: string;
    github: string;
    portfolio: string;
}

export interface PersonalInfo {
    date_of_birth: string;
    gender: string;
    nationality: string;
    // Ethnic group ("Kinh") — VN forms (and Workday VN tenants' Race/Ethnicity
    // prompt) ask it as an administrative fact; the decline phrasings the agent
    // otherwise uses don't exist in that country-specific option list.
    ethnicity: string;
    // Tên đệm ("Nam" in Võ Nam Hiếu). Some tenants (P&G) render "Intercalary
    // (or Middle) Name" as a REQUIRED field in both scripts — and it is not
    // derivable when the CV's own name line omits it, so it has to be askable.
    middle_name: string;
    // "Do you hold a valid driver's license?" — Unilever asks it REQUIRED.
    // Yes/Có or No/Không; empty = the agent reports a named gap, never guesses.
    drivers_license: string;
    marital_status: string;
}

export interface EmploymentInfo {
    current_title: string;
    current_company: string;
    current_level: string;
    current_industry: string;
    current_fields: string;
    current_salary: string;
    years_of_experience: number;
    highest_degree: string;
}

export interface JobPreferences {
    desired_locations: string;
    desired_salary: string;
    /** Answers application forms demand that a CV never states. Collected once,
     *  reused at every company — the alternative is what happens today: an
     *  application stalls on "Notice period", the user fixes it by hand, and the
     *  next company asks exactly the same thing.
     *  Optional so existing saved CVs still type-check. */
    notice_period?: string;
    /** "Are you legally authorized to work in X?" — a material statement, so the
     *  agent never guesses it. Stored as the candidate's own answer. */
    work_authorized?: string;
    /** "Will you require visa sponsorship?" — same reasoning. */
    requires_sponsorship?: string;
    /** "What is your earliest available start date?" (PwC asks it REQUIRED as a
     *  full date). YYYY-MM-DD. Empty → the agent derives today + notice period. */
    available_start_date?: string;
}

// Languages a cover letter can be generated in. Add an entry here and it shows
// up in the picker + is accepted by the generator — no other code changes.
// The value is the native label shown in the dropdown AND passed to the model
// as the target language, so keep it in that language's own script.
export const COVER_LETTER_LANGUAGES: Record<string, string> = {
    vi: 'Tiếng Việt',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
    zh: '中文',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
};


export interface CVData {
    name: string;
    summary: string;
    // AI-inferred target role (filled during CV extraction). Optional so CVData
    // persisted before this field existed still type-checks.
    desired_job_title?: string;
    skills: string[];
    experience: ExperienceDetail[];
    education: EducationDetail[];
    projects: ProjectDetail[];
    // Optional so CVData persisted before these sections existed still type-checks.
    certifications?: CertificationDetail[];
    languages?: LanguageDetail[];
    awards?: AwardDetail[];
    activities?: ActivityDetail[];
    contact: ContactInfo;
    personal: PersonalInfo;
    employment: EmploymentInfo;
    preferences: JobPreferences;
}

export const EMPTY_CONTACT: ContactInfo = {
    email: '', phone: '',
    address_province: '', address_district: '', address_street: '',
    linkedin: '', github: '', portfolio: '',
};

export const EMPTY_PERSONAL: PersonalInfo = {
    date_of_birth: '', gender: '', nationality: '', ethnicity: '', middle_name: '', drivers_license: '', marital_status: '',
};

export const EMPTY_EMPLOYMENT: EmploymentInfo = {
    current_title: '', current_company: '', current_level: '',
    current_industry: '', current_fields: '', current_salary: '',
    years_of_experience: 0, highest_degree: '',
};

export const EMPTY_PREFERENCES: JobPreferences = {
    desired_locations: '', desired_salary: '',
};

export interface JDData {
    must_have: string[];
    nice_to_have: string[];
    responsibilities: string[];
    seniority_expected: string;
    // Minimum years of professional experience the JD requires (0 = unstated).
    // Used to drop jobs that out-reach the candidate by more than 1 year.
    required_years_min?: number;
    domain: string;
}

export type RequirementStatus = "met" | "partial" | "missing";

export interface RequirementMatch {
    requirement: string;
    status: RequirementStatus;
    evidence: string;
}

export interface CategoryScore {
    score: number;
    reasoning: string;
    gaps: string[];
    // Only populated on must_have_match: the AI's verdict per JD requirement.
    // Drives the ✓/✗ chips in the UI (replaces naive frontend substring match).
    // Absent on older cached results — callers must fall back gracefully.
    requirements?: RequirementMatch[];
}

export interface MatchResult {
    overall_score: number;
    must_have_match: CategoryScore;
    experience_match: CategoryScore;
    domain_match: CategoryScore;
    seniority_match: CategoryScore;
    nice_to_have_match: CategoryScore;
    strength_summary: string;
    risk_flags: string[];
}
