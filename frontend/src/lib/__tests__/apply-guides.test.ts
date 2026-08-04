// Which employers get a "Hướng dẫn apply" button.
//
// The match runs on a company name that reaches us spelled several ways — the
// ATS ingest stores "Mondelez Kinh Do", an admin typing a promoted card writes
// "Mondelēz Kinh Đô". Both must resolve, and nothing else may.

import { describe, expect, test } from "vitest";
import { resolveApplyGuide } from "../apply-guides";

describe("resolveApplyGuide", () => {
    test("matches Mondelēz however the name is spelled", () => {
        for (const name of [
            "Mondelez Kinh Do",
            "Mondelēz Kinh Đô",
            "MONDELEZ INTERNATIONAL",
            "Mondelez Vietnam",
        ]) {
            expect(resolveApplyGuide(name)?.id).toBe("mondelez");
        }
    });

    test("no guide for other companies, or no company at all", () => {
        for (const name of ["Unilever Vietnam (Uniquely U)", "Nestlé Vietnam", "", null, undefined]) {
            expect(resolveApplyGuide(name)).toBeNull();
        }
    });

    test("guide content loads and every section carries blocks", async () => {
        const ref = resolveApplyGuide("Mondelez Kinh Do")!;
        const guide = await ref.load();
        expect(guide.sections.length).toBeGreaterThan(0);
        for (const s of guide.sections) {
            expect(s.id).toBeTruthy();
            expect(s.blocks.length).toBeGreaterThan(0);
        }
        // Section ids are the nav keys — duplicates would collide as React keys.
        expect(new Set(guide.sections.map((s) => s.id)).size).toBe(guide.sections.length);
    });
});
