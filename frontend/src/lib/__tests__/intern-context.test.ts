// Only an internship application is gated, and only for what it actually needs.
//
// Measured on Workday (R-172558 Marketing Intern): intern postings require
// Education's GPA and Field of Study, executive ones do not. These pure helpers
// decide "is this intern-relevant" and "what is still missing" so the profile
// form can require the fields and the batch can skip an intern job that would
// gap mid-run — without touching the executive path.

import { describe, expect, test } from "vitest";
import type { CVData } from "../types";
import { internBlockReason, internCvGaps, isInternJob, isStudentOrNewGrad } from "../intern-context";

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

describe("internCvGaps", () => {
    test("names each missing field, and nothing when both are present", () => {
        expect(internCvGaps(withEdu({ degree: "Marketing", gpa: "3.6" }))).toEqual([]);
        expect(internCvGaps(withEdu({ degree: "Marketing", gpa: "" }))).toEqual(["Điểm TB (GPA)"]);
        expect(internCvGaps(withEdu({ degree: "", gpa: "3.6" }))).toEqual(["Ngành học / Bằng cấp"]);
        expect(internCvGaps(withEdu({ degree: "", gpa: "" })).length).toBe(2);
    });
});

describe("internBlockReason — only intern jobs are ever blocked", () => {
    test("an intern job missing GPA is blocked, named by what it needs", () => {
        expect(internBlockReason({ jobTitle: "Marketing Intern" }, withEdu({ degree: "Marketing", gpa: "" })))
            .toBe("Điểm TB (GPA)");
    });
    test("an intern job with everything is not blocked", () => {
        expect(internBlockReason({ jobTitle: "Marketing Intern" }, withEdu({ degree: "Marketing", gpa: "3.6" })))
            .toBeNull();
    });
    test("an EXECUTIVE job missing GPA is never blocked", () => {
        expect(internBlockReason({ jobTitle: "Bill To Cash Manager" }, withEdu({ degree: "", gpa: "" })))
            .toBeNull();
    });
});
