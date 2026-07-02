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
    linkedin: string;
    github: string;
    portfolio: string;
}

export interface PersonalInfo {
    date_of_birth: string;
    gender: string;
    nationality: string;
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
}

// Per-job cover letter, generated in both languages so the user can switch.
export interface CoverLetter {
    vi: string;
    en: string;
}

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
    date_of_birth: '', gender: '', nationality: '', marital_status: '',
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
