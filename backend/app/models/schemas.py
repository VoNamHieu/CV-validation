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

class CVSchema(BaseModel):
    name: str = Field(default="", description="Full name of the candidate")
    summary: str = Field(default="", description="Professional summary or objective")
    skills: List[str] = Field(default_factory=list, description="List of technical and soft skills")
    experience: List[ExperienceDetail] = Field(default_factory=list)
    education: List[EducationDetail] = Field(default_factory=list)
    projects: List[ProjectDetail] = Field(default_factory=list)

class JDSchema(BaseModel):
    must_have: List[str] = Field(default_factory=list, description="Strictly required skills, tools, or experiences")
    nice_to_have: List[str] = Field(default_factory=list, description="Bonus skills, tools, or experiences")
    responsibilities: List[str] = Field(default_factory=list, description="Key duties expected in the role")
    seniority_expected: str = Field(default="", description="e.g., Junior, Mid-level, Senior, Executive")
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
