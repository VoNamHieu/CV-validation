// Resolving a CV's field of study to a value Workday's closed catalogue accepts.
//
// The measured problem (R-172558): Field of Study is a single-select closed list
// of 327 English majors, so a Vietnamese major or an English one the list does
// not carry never matches and the intern form gaps. These are pure functions,
// FE-only — the extension is never asked to translate.

import { afterEach, describe, expect, test, vi } from "vitest";
import type { CVData } from "../types";
import { FIELD_OF_STUDY_CATALOG } from "../field-of-study-catalog";
import { foldMajor, isCatalogueFieldOfStudy, isResolvableMajor, resolveCvFieldsOfStudy, resolveFieldOfStudy } from "../field-of-study";

const CATALOG = new Set(FIELD_OF_STUDY_CATALOG);

describe("foldMajor strips Vietnamese diacritics and case", () => {
    test("tones, đ, case, and spacing all collapse", () => {
        expect(foldMajor("Kinh tế Quốc tế")).toBe("kinh te quoc te");
        expect(foldMajor("Kinh tế đối ngoại")).toBe("kinh te doi ngoai");
        expect(foldMajor("  INTERNATIONAL   Business ")).toBe("international business");
    });

    test("EDGE punctuation is stripped, INNER punctuation survives", () => {
        // a CV left a comma/period/quote on the end — must not miss the row
        expect(foldMajor("Computer Science,")).toBe("computer science");
        expect(foldMajor("Finance.")).toBe("finance");
        expect(foldMajor('"Data Science"')).toBe("data science");
        // real catalogue labels carry inner commas/slashes — those stay
        expect(foldMajor("African Languages, Literatures, and Linguistics"))
            .toBe("african languages, literatures, and linguistics");
        expect(foldMajor("Agricultural/Biological Engineering"))
            .toBe("agricultural/biological engineering");
    });
});

describe("resolveFieldOfStudy tolerates a stray edge comma", () => {
    test("a trailing comma no longer misses an exact catalogue row", () => {
        // "Marketing," folded equal to "Marketing" → canonical, not raw
        expect(resolveFieldOfStudy("Marketing,")).toBe("Marketing");
        expect(resolveFieldOfStudy("Data Science.")).toBe("Data Science");
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

describe("isCatalogueFieldOfStudy — is this ALREADY a catalogue row (post-resolution)", () => {
    test("true only for an actual catalogue major, any case/accent", () => {
        expect(isCatalogueFieldOfStudy("Marketing")).toBe(true);
        expect(isCatalogueFieldOfStudy("INTERNATIONAL BUSINESS")).toBe(true);
    });
    test("a still-raw VN major is NOT a catalogue row (it must be resolved first)", () => {
        // isResolvableMajor is true (the dict can place it), but until it is
        // actually resolved it is not a value the closed dropdown accepts.
        expect(isCatalogueFieldOfStudy("Kinh doanh quốc tế")).toBe(false);
    });
    test("a degree/qualification is never a catalogue major", () => {
        expect(isCatalogueFieldOfStudy("B.B.A.")).toBe(false);
        expect(isCatalogueFieldOfStudy("Bachelor of Arts")).toBe(false);
    });
    test("empty / unknown → false", () => {
        expect(isCatalogueFieldOfStudy("")).toBe(false);
        expect(isCatalogueFieldOfStudy(null)).toBe(false);
        expect(isCatalogueFieldOfStudy("Underwater Basket Weaving")).toBe(false);
    });
});

// A CVData is a big interface; the resolver only ever touches `.education`, so a
// cast keeps the fixtures readable without inventing the other twenty fields.
const cvWith = (education: Array<Partial<CVData["education"][number]>>): CVData =>
    ({ education } as unknown as CVData);

describe("resolveCvFieldsOfStudy (deterministic + LLM long tail)", () => {
    afterEach(() => vi.unstubAllGlobals());

    test("a deterministic-resolvable major never reaches the LLM", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const out = await resolveCvFieldsOfStudy(cvWith([{ field_of_study: "Kinh doanh quốc tế" }]));
        expect(out.education[0].field_of_study).toBe("International Business");
        expect(fetchSpy).not.toHaveBeenCalled();   // rules placed it — no network
    });

    test("an unknown major is resolved via the LLM route and validated", async () => {
        // "Marketing" is a known catalogue row (see resolveFieldOfStudy tests);
        // the raw is an unusual major the rules cannot place, so it reaches here.
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ map: { "Ngành lạ đặc biệt XYZ": "Marketing" } }),
        });
        vi.stubGlobal("fetch", fetchSpy);
        const out = await resolveCvFieldsOfStudy(cvWith([{ field_of_study: "Ngành lạ đặc biệt XYZ" }]));
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(out.education[0].field_of_study).toBe("Marketing");
        expect(FIELD_OF_STUDY_CATALOG.includes(out.education[0].field_of_study!)).toBe(true);
    });

    test("a hallucinated LLM label is rejected — the raw value stays", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ map: { "Ngành bịa": "Totally Made Up Major" } }),
        }));
        const out = await resolveCvFieldsOfStudy(cvWith([{ field_of_study: "Ngành bịa" }]));
        expect(out.education[0].field_of_study).toBe("Ngành bịa");
    });

    test("an LLM/network failure never throws — the value stays raw", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
        const out = await resolveCvFieldsOfStudy(cvWith([{ field_of_study: "Ngành gì đó rất lạ" }]));
        expect(out.education[0].field_of_study).toBe("Ngành gì đó rất lạ");
    });

    test("no education is returned untouched", async () => {
        const cv = cvWith([]);
        expect(await resolveCvFieldsOfStudy(cv)).toBe(cv);
    });
});
