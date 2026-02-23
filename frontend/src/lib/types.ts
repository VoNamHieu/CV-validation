// Shared type definitions matching the Pydantic schemas from the backend

export interface ExperienceDetail {
    title: string;
    company: string;
    duration_months: number;
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

export interface CVData {
    name: string;
    summary: string;
    skills: string[];
    experience: ExperienceDetail[];
    education: EducationDetail[];
    projects: ProjectDetail[];
}

export interface JDData {
    must_have: string[];
    nice_to_have: string[];
    responsibilities: string[];
    seniority_expected: string;
    domain: string;
}

export interface CategoryScore {
    score: number;
    reasoning: string;
    gaps: string[];
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
