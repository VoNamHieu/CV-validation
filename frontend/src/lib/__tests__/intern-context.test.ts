// Only an internship application is gated, and only for what it actually needs.
//
// Measured on Workday (R-172558 Marketing Intern): intern postings require
// Education's GPA and Field of Study, executive ones do not. These pure helpers
// decide "is this intern-relevant" and "what is still missing" so the profile
// form can require the fields and the batch can skip an intern job that would
// gap mid-run — without touching the executive path.

import { describe, expect, test } from "vitest";
import type { CVData } from "../types";
import { internApplyGaps, internBlockReason, internCvGaps, isInternJob, isStudentOrNewGrad } from "../intern-context";

const cv = (over: Partial<CVData>): CVData =>
    ({ education: [], experience: [], employment: { years_of_experience: 10 } } as unknown as CVData);
const withEdu = (edu: Partial<CVData["education"][number]>, over: Partial<CVData> = {}): CVData =>
    ({ education: [edu], experience: [{}], employment: { years_of_experience: 10 }, ...over } as unknown as CVData);

describe("isInternJob", () => {
    test("titles that read as an internship / early-career hire", () => {
        for (const t of ["Marketing Intern", "Demand Planning Internship", "Thực tập sinh Marketing",
            "Management Trainee", "Graduate Trainee - Finance", "Campus Ambassador", "Fresher Developer"]) {
            expect(isInternJob({ jobTitle: t })).toBe(true);
        }
    });
    test("a manager role is not an internship", () => {
        for (const t of ["Bill To Cash Manager", "People Lead, Corporate Functions", "Procurement Manager"]) {
            expect(isInternJob({ jobTitle: t })).toBe(false);
        }
    });
    test('"Internal Auditor" is not an intern — the word boundary matters', () => {
        expect(isInternJob({ jobTitle: "Internal Auditor" })).toBe(false);
    });
});

describe("isStudentOrNewGrad", () => {
    test("≤1 year of experience, or none at all, reads as a new grad", () => {
        expect(isStudentOrNewGrad(cv({ employment: { years_of_experience: 0 } as CVData["employment"] }))).toBe(true);
        expect(isStudentOrNewGrad(cv({ employment: { years_of_experience: 1 } as CVData["employment"] }))).toBe(true);
        expect(isStudentOrNewGrad({ experience: [], employment: { years_of_experience: 5 } } as unknown as CVData)).toBe(true);
    });
    test("an experienced candidate is not", () => {
        expect(isStudentOrNewGrad({ experience: [{}, {}], employment: { years_of_experience: 6 } } as unknown as CVData)).toBe(false);
    });
});

describe("internCvGaps — sync presence check (degree is NOT a major)", () => {
    test("needs a field_of_study of its own, and a GPA", () => {
        expect(internCvGaps(withEdu({ field_of_study: "Marketing", gpa: "3.6" }))).toEqual([]);
        expect(internCvGaps(withEdu({ field_of_study: "Marketing", gpa: "" }))).toEqual(["Điểm TB (GPA)"]);
        expect(internCvGaps(withEdu({ field_of_study: "", gpa: "3.6" }))).toEqual(["Ngành học"]);
        expect(internCvGaps(withEdu({ field_of_study: "", gpa: "" })).length).toBe(2);
    });
    test("a degree no longer MASKS a missing major (the P1c fix)", () => {
        // The exact repro: a qualification is present, the major is not. A
        // degree cannot fill Field of Study, so this must read as a gap — the old
        // `field_of_study || degree` wrongly returned [].
        expect(internCvGaps(withEdu({ degree: "B.B.A.", field_of_study: "", gpa: "3.6" }))).toEqual(["Ngành học"]);
    });
});

describe("internApplyGaps — apply-time gate on the RESOLVED cv (must be a catalogue major)", () => {
    test("a real catalogue major with a GPA passes", () => {
        expect(internApplyGaps(withEdu({ field_of_study: "International Business", gpa: "3.6" }))).toEqual([]);
        expect(internApplyGaps(withEdu({ field_of_study: "Marketing", gpa: "3.6" }))).toEqual([]);
    });
    test("a value that did NOT resolve to a catalogue row is a gap — no fail-open", () => {
        // A still-raw Vietnamese major (resolution failed) is not a catalogue row.
        expect(internApplyGaps(withEdu({ field_of_study: "Ngành siêu lạ XYZ", gpa: "3.6" }))).toEqual(["Ngành học"]);
        // An empty major.
        expect(internApplyGaps(withEdu({ field_of_study: "", gpa: "3.6" }))).toEqual(["Ngành học"]);
    });
    test("a degree in the field_of_study slot is rejected (the downstream-gap repro)", () => {
        // "B.B.A." is a qualification, not a major, and is not on the catalogue —
        // exactly the value that used to slip through and gap My Experience.
        expect(internApplyGaps(withEdu({ degree: "B.B.A.", field_of_study: "B.B.A.", gpa: "3.6" }))).toEqual(["Ngành học"]);
        expect(internApplyGaps(withEdu({ degree: "B.B.A.", field_of_study: "", gpa: "3.6" }))).toEqual(["Ngành học"]);
    });
    test("a missing GPA is still named alongside", () => {
        expect(internApplyGaps(withEdu({ field_of_study: "Marketing", gpa: "" }))).toEqual(["Điểm TB (GPA)"]);
        expect(internApplyGaps(withEdu({ field_of_study: "Ngành lạ", gpa: "" })).sort())
            .toEqual(["Điểm TB (GPA)", "Ngành học"].sort());
    });
});

describe("internBlockReason — only intern jobs are ever blocked", () => {
    test("an intern job missing GPA is blocked, named by what it needs", () => {
        expect(internBlockReason({ jobTitle: "Marketing Intern" }, withEdu({ field_of_study: "Marketing", gpa: "" })))
            .toBe("Điểm TB (GPA)");
    });
    test("an intern job with everything is not blocked", () => {
        expect(internBlockReason({ jobTitle: "Marketing Intern" }, withEdu({ field_of_study: "Marketing", gpa: "3.6" })))
            .toBeNull();
    });
    test("an EXECUTIVE job missing GPA is never blocked", () => {
        expect(internBlockReason({ jobTitle: "Bill To Cash Manager" }, withEdu({ field_of_study: "", gpa: "" })))
            .toBeNull();
    });
});
