// Splitting a CV name into the given/family pair an ATS asks for.
//
// This is not a formatting nicety: the pair goes into a legal-name field on a
// real application, and both defects below were observed on a live Workday form.

import { describe, expect, test } from "vitest";
import { splitLegalName } from "../extension-profile";

describe("splitLegalName", () => {
    test("Vietnamese order — family name first, given name last", () => {
        expect(splitLegalName("Võ Nam Hiếu")).toEqual({ firstName: "Hiếu", lastName: "Võ Nam" });
        expect(splitLegalName("Nguyễn Thị Mai")).toEqual({ firstName: "Mai", lastName: "Nguyễn Thị" });
    });

    test("Western order — the same person written given-name-first", () => {
        // The measured defect: the old rule always took the last token as the
        // given name, so this submitted Family Name = "HIEU", Given Name = "VO"
        // to a real employer — both fields wrong, names swapped.
        expect(splitLegalName("HIEU VO")).toEqual({ firstName: "HIEU", lastName: "VO" });
        expect(splitLegalName("Mai Tran")).toEqual({ firstName: "Mai", lastName: "Tran" });
    });

    test("a parenthesised nickname never reaches the legal name", () => {
        // The second measured defect. "HIEU (CHARLES) VO" put "(CHARLES)" into the
        // family-name field, which raised two Workday capitalization alerts — and a
        // legal-name field is the one place a nickname does not belong.
        expect(splitLegalName("HIEU (CHARLES) VO")).toEqual({ firstName: "HIEU", lastName: "VO" });
        expect(splitLegalName("Nguyễn Văn A (Andy)")).toEqual({ firstName: "A", lastName: "Nguyễn Văn" });
        expect(splitLegalName("Hieu [Charles] Vo")).toEqual({ firstName: "Hieu", lastName: "Vo" });
    });

    test("diacritics are optional on the family-name signal", () => {
        expect(splitLegalName("HIEU VÕ").lastName).toBe("VÕ");
        expect(splitLegalName("Hieu Vo").lastName).toBe("Vo");
    });

    test("an ambiguous name keeps the Vietnamese reading rather than flipping", () => {
        // Both ends are plausible family names here. Guessing Western order would
        // be no better founded than the default, and this product's users are
        // predominantly Vietnamese — so the default stands.
        expect(splitLegalName("Nguyen Van Le")).toEqual({ firstName: "Le", lastName: "Nguyen Van" });
    });

    test("names that are ALSO common given names are kept out of the signal", () => {
        // Mai, Cao, Chu, Lâm are real family names and common given names. Listing
        // them made both ends of "Mai Tran" look like a family name, which lands it
        // in the ambiguous branch above and keeps the WRONG reading — so they are
        // deliberately absent, and this asserts the consequence.
        expect(splitLegalName("Mai Tran")).toEqual({ firstName: "Mai", lastName: "Tran" });
        expect(splitLegalName("Lam Nguyen")).toEqual({ firstName: "Lam", lastName: "Nguyen" });
    });

    test("a name with no recognised family name is unchanged from before", () => {
        expect(splitLegalName("John Michael Smith")).toEqual({ firstName: "Smith", lastName: "John Michael" });
    });

    test("degenerate input does not throw", () => {
        expect(splitLegalName("")).toEqual({ firstName: "", lastName: "" });
        expect(splitLegalName("   ")).toEqual({ firstName: "", lastName: "" });
        expect(splitLegalName("Hieu")).toEqual({ firstName: "Hieu", lastName: "" });
        expect(splitLegalName("(Charles)")).toEqual({ firstName: "", lastName: "" });
    });
});
