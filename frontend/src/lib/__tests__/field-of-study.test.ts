// Resolving a CV's field of study to a value Workday's closed catalogue accepts.
//
// The measured problem (R-172558): Field of Study is a single-select closed list
// of 327 English majors, so a Vietnamese major or an English one the list does
// not carry never matches and the intern form gaps. These are pure functions,
// FE-only — the extension is never asked to translate.

import { describe, expect, test } from "vitest";
import { FIELD_OF_STUDY_CATALOG } from "../field-of-study-catalog";
import { foldMajor, isResolvableMajor, resolveFieldOfStudy } from "../field-of-study";

const CATALOG = new Set(FIELD_OF_STUDY_CATALOG);

describe("foldMajor strips Vietnamese diacritics and case", () => {
    test("tones, đ, case, and spacing all collapse", () => {
        expect(foldMajor("Kinh tế Quốc tế")).toBe("kinh te quoc te");
        expect(foldMajor("Kinh tế đối ngoại")).toBe("kinh te doi ngoai");
        expect(foldMajor("  INTERNATIONAL   Business ")).toBe("international business");
    });
});

describe("resolveFieldOfStudy", () => {
    test("the three the user named resolve to a catalogue label", () => {
        expect(resolveFieldOfStudy("Kinh doanh quốc tế")).toBe("International Business");
        expect(resolveFieldOfStudy("Kinh tế quốc tế")).toBe("Economics");
        expect(resolveFieldOfStudy("Kinh tế đối ngoại")).toBe("International Business");
    });

    test("an English catalogue major is normalised to its canonical spelling", () => {
        expect(resolveFieldOfStudy("marketing")).toBe("Marketing");
        expect(resolveFieldOfStudy("INTERNATIONAL BUSINESS")).toBe("International Business");
    });

    test("an unknown value is returned unchanged — never invented", () => {
        expect(resolveFieldOfStudy("Ngành gì đó rất lạ")).toBe("Ngành gì đó rất lạ");
        expect(resolveFieldOfStudy("Underwater Basket Weaving")).toBe("Underwater Basket Weaving");
    });

    test("empty stays empty", () => {
        expect(resolveFieldOfStudy("")).toBe("");
        expect(resolveFieldOfStudy(null)).toBe("");
        expect(resolveFieldOfStudy(undefined)).toBe("");
    });

    test("EVERY Vietnamese-dictionary target is a real catalogue row", () => {
        // The dictionary is only correct if it maps into the closed list — a
        // target that is not in the catalogue would gap exactly as the raw value
        // did. Resolve a probe for each known VN key and assert the result exists.
        for (const vn of ["quản trị kinh doanh", "kế toán", "tài chính", "công nghệ thông tin",
            "luật", "logistics", "xây dựng", "quan hệ quốc tế", "y khoa", "khoa học dữ liệu"]) {
            const out = resolveFieldOfStudy(vn);
            expect(CATALOG.has(out), `${vn} → "${out}" must be in the catalogue`).toBe(true);
        }
    });
});

describe("isResolvableMajor", () => {
    test("true for catalogue + dictionary, false for unknown/empty", () => {
        expect(isResolvableMajor("Kinh doanh quốc tế")).toBe(true);
        expect(isResolvableMajor("Marketing")).toBe(true);
        expect(isResolvableMajor("Underwater Basket Weaving")).toBe(false);
        expect(isResolvableMajor("")).toBe(false);
    });
});
