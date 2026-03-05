"""Tests for Pydantic schema validation."""
import pytest
from pydantic import ValidationError
from app.models.schemas import (
    CVSchema, JDSchema, MatchResultSchema,
    ExperienceDetail, EducationDetail, ProjectDetail, CategoryScore,
)


class TestCVSchema:
    def test_creates_with_defaults(self):
        cv = CVSchema()
        assert cv.name == ""
        assert cv.summary == ""
        assert cv.skills == []
        assert cv.experience == []
        assert cv.education == []
        assert cv.projects == []

    def test_creates_with_full_data(self):
        cv = CVSchema(
            name="John Doe",
            summary="Senior developer",
            skills=["Python", "React", "Docker"],
            experience=[ExperienceDetail(
                title="Lead Dev",
                company="Acme",
                duration_months=24,
                description="Built microservices",
            )],
            education=[EducationDetail(degree="BS CS", institution="MIT", year="2020")],
            projects=[ProjectDetail(name="OpenSource", description="A cool project")],
        )
        assert cv.name == "John Doe"
        assert len(cv.skills) == 3
        assert cv.experience[0].company == "Acme"
        assert cv.education[0].institution == "MIT"

    def test_serializes_to_json(self):
        cv = CVSchema(name="Test", skills=["Python"])
        data = cv.model_dump()
        assert data["name"] == "Test"
        assert data["skills"] == ["Python"]

    def test_experience_requires_all_fields(self):
        with pytest.raises(ValidationError):
            ExperienceDetail(title="Dev")  # missing company, duration_months, description


class TestJDSchema:
    def test_creates_with_defaults(self):
        jd = JDSchema()
        assert jd.must_have == []
        assert jd.nice_to_have == []
        assert jd.responsibilities == []
        assert jd.seniority_expected == ""
        assert jd.domain == ""

    def test_creates_with_full_data(self):
        jd = JDSchema(
            must_have=["Python", "FastAPI"],
            nice_to_have=["Docker"],
            responsibilities=["Build APIs"],
            seniority_expected="Senior",
            domain="Fintech",
        )
        assert len(jd.must_have) == 2
        assert jd.seniority_expected == "Senior"


class TestMatchResultSchema:
    def test_creates_valid_match(self):
        cat = CategoryScore(score=75, reasoning="Good fit", gaps=["Missing Docker"])
        match = MatchResultSchema(
            overall_score=72,
            must_have_match=cat,
            experience_match=cat,
            domain_match=cat,
            seniority_match=cat,
            nice_to_have_match=cat,
            strength_summary="Strong candidate",
            risk_flags=["No Docker experience"],
        )
        assert match.overall_score == 72
        assert match.must_have_match.score == 75
        assert len(match.risk_flags) == 1

    def test_requires_all_categories(self):
        cat = CategoryScore(score=50, reasoning="OK", gaps=[])
        with pytest.raises(ValidationError):
            MatchResultSchema(
                overall_score=50,
                must_have_match=cat,
                # Missing other categories
            )

    def test_risk_flags_default_empty(self):
        cat = CategoryScore(score=50, reasoning="OK", gaps=[])
        match = MatchResultSchema(
            overall_score=50,
            must_have_match=cat,
            experience_match=cat,
            domain_match=cat,
            seniority_match=cat,
            nice_to_have_match=cat,
            strength_summary="Decent",
        )
        assert match.risk_flags == []
