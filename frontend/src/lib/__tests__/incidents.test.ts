// What counts as a real API failure vs the browser's own transport.
//
// A rejected fetch is indistinguishable from an API fault by its message alone
// ("Failed to fetch"), so the decision is made from the surrounding state. Get
// it wrong in one direction and the incident log fills with laptops waking up;
// wrong in the other and a genuine outage goes unrecorded.

import { describe, expect, test } from "vitest";
import { isTransportNoise } from "../incidents";

const REACHABLE = { online: true, hidden: false, unloading: false };

describe("isTransportNoise", () => {
    test("a failure with the tab open, online and settled is a real one", () => {
        expect(isTransportNoise({ ...REACHABLE })).toBe(false);
        expect(isTransportNoise({ ...REACHABLE, errorName: "TypeError" })).toBe(false);
    });

    test("the browser's own causes are not incidents", () => {
        expect(isTransportNoise({ ...REACHABLE, online: false })).toBe(true);   // offline
        expect(isTransportNoise({ ...REACHABLE, hidden: true })).toBe(true);    // backgrounded tab
        expect(isTransportNoise({ ...REACHABLE, unloading: true })).toBe(true); // reload / navigate
        expect(isTransportNoise({ ...REACHABLE, errorName: "AbortError" })).toBe(true);
        expect(isTransportNoise({ ...REACHABLE, errorName: "TimeoutError" })).toBe(true);
    });
});
