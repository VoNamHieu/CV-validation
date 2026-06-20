from pydantic import BaseModel, Field
from typing import List, Optional

class ExperienceDetail(BaseModel):
    title: str = Field(description="Job title")
    company: str = Field(description="Company name")
    duration_months: int = Field(description="Total months worked in this role. If current, calculate up to present.")
    description: str = Field(description="Detailed bullet points of responsibilities and achievements")

class EducationDetail(BaseModel):
    degree: str
    institution: str
    year: str = Field(description="Graduation year or date range")

class ProjectDetail(BaseModel):
    name: str
    description: str

class ContactInfo(BaseModel):
    email: str = ""
    phone: str = ""
    address_province: str = Field(default="", description="Province / city / region")
    address_district: str = Field(default="", description="District / ward (Vietnamese-style addresses)")
    address_street: str = Field(default="", description="Street address line")
    linkedin: str = ""
    github: str = ""
    portfolio: str = Field(default="", description="Personal website or portfolio URL")

class PersonalInfo(BaseModel):
    date_of_birth: str = Field(default="", description="ISO date string YYYY-MM-DD if known")
    gender: str = ""
    nationality: str = ""
    marital_status: str = ""

class EmploymentInfo(BaseModel):
    current_title: str = ""
    current_company: str = ""
    current_level: str = Field(default="", description="e.g., Junior, Mid, Senior, Lead")
    current_industry: str = ""
    current_fields: str = Field(default="", description="Functional area, e.g., Backend, Data, Product")
    current_salary: str = ""
    years_of_experience: int = 0
    highest_degree: str = ""

class JobPreferences(BaseModel):
    desired_locations: str = ""
    desired_salary: str = ""

class CVSchema(BaseModel):
    name: str = Field(default="", description="Full name of the candidate")
    summary: str = Field(default="", description="Professional summary or objective")
    skills: List[str] = Field(default_factory=list, description="List of technical and soft skills")
    experience: List[ExperienceDetail] = Field(default_factory=list)
    education: List[EducationDetail] = Field(default_factory=list)
    projects: List[ProjectDetail] = Field(default_factory=list)
    contact: ContactInfo = Field(default_factory=ContactInfo)
    personal: PersonalInfo = Field(default_factory=PersonalInfo)
    employment: EmploymentInfo = Field(default_factory=EmploymentInfo)
    preferences: JobPreferences = Field(default_factory=JobPreferences)

class JDSchema(BaseModel):
    must_have: List[str] = Field(default_factory=list, description="Strictly required skills, tools, or experiences")
    nice_to_have: List[str] = Field(default_factory=list, description="Bonus skills, tools, or experiences")
    responsibilities: List[str] = Field(default_factory=list, description="Key duties expected in the role")
    seniority_expected: str = Field(default="", description="e.g., Junior, Mid-level, Senior, Executive")
    required_years_min: int = Field(default=0, description="Minimum years of professional experience required (0 = unstated)")
    domain: str = Field(default="", description="e.g., Fintech, E-commerce, Healthcare")

class CategoryScore(BaseModel):
    score: int = Field(description="Score from 0 to 100")
    reasoning: str = Field(description="Brief explanation of the score based on the CV vs JD")
    gaps: List[str] = Field(description="Specific things missing from the CV")

class MatchResultSchema(BaseModel):
    overall_score: int = Field(description="Weighted overall score from 0 to 100")
    must_have_match: CategoryScore
    experience_match: CategoryScore
    domain_match: CategoryScore
    seniority_match: CategoryScore
    nice_to_have_match: CategoryScore
    strength_summary: str = Field(description="Short summary of why the candidate is a fit")
    risk_flags: List[str] = Field(default_factory=list, description="Any red flags, e.g., missing critical skill, massive seniority gap")
