# Workday fixture corpus — measured widget behavior, frozen

One JSON per (tenant, field). Each fixture is a **structural snapshot of a
widget as it was actually measured on a live run** — option lists the tenant
really served, ladder values the agent really tried, and the outcome the live
run proved correct. Nothing in here is invented: if a list isn't in a trace or
a HAR, it doesn't go in a fixture. Partial knowledge is recorded as partial
(`measuredEdgeLabelsOnly: true`) rather than filled in by guesswork.

## What fixtures are for

1. **Today (Phase 1):** `option-match.fixtures.test.js` runs the CURRENT pure
   matchers (`optionMatchAll`, `pickSearchResult`, `skillFallbacks`) against
   these lists and pins the answers the live runs proved right — above all the
   no-false-claim rule: a term the tenant's catalogue doesn't hold must resolve
   to NOTHING, never to a fuzzy neighbour ("retention optimization" must not
   become "Retention Strategies" on a real application).
2. **Phase 2–4:** the `intent` / `shape` blocks become the expected outputs of
   the WHAT layer and the fingerprint classifier.
3. **Wave 1+:** a capability version is promoted to a pinned tenant only after
   replaying that tenant's fixtures green. Changing a fixture to make a test
   pass is the one forbidden move — fixtures change only when a NEW live
   measurement says the tenant itself changed.

## Schema (informal)

```jsonc
{
  "tenant": "mdlz",                  // tenant key
  "field": "Skills",                 // label as the tenant renders it
  "intent": "candidate.skills",      // WHAT (Phase 2 target)
  "capability": "searchable-multi",  // HOW family OBSERVED at this tenant — see below
  "commitSignal": "chip",            // the only evidence of success
  "shape": { ... },                  // observed DOM signals (fingerprint input)
  "measured": { ... },               // per-fixture: queries/levels/ladders + expectations
  "source": "which run/trace/HAR this was measured from"
}
```

## `capability` is an observation, never a mapping

The `capability` field records which widget family this tenant happened to
render for this field — it is data ABOUT the tenant, derived from `shape`.
It must never be read as "this intent → this capability": Skills on another
tenant can be a checkbox group or a plain tag input, and the same intent
carrying DIFFERENT capabilities across fixtures is expected and healthy (the
two source-hierarchical fixtures in this corpus already differ structurally
for one label). The orchestrator resolves capability from the FINGERPRINT it
observes at runtime — the fixture's `capability` only says what that
resolution produced on the measured run, so drift is detectable. A rule like
`intent === 'candidate.skills' → searchable-multi` is the forbidden shortcut
this corpus exists to make impossible to defend.

## Layout

```
workday/
  mdlz/   — Mondelēz (wd3.myworkdaysite.com/mdlz)
  pwc/    — PwC (pwc.wd3.myworkdayjobs.com)
```

The same field on two tenants deliberately gets two fixtures: "How Did You
Hear About Us?" is a 3-row cascade on mdlz and a 64-row two-level cascade on
PwC — same label, different widget, which is exactly why HOW must never be
chosen from a label.

Behavioral pathologies that fixtures CANNOT carry (virtualiser row recycling,
delayed commits, collapsed clip rects) live in `../harness/hostile-widget.html`
— static data tests the matcher, the harness tests the interaction.
