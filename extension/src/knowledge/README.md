# knowledge/ — the experience library

Measured knowledge, as **data**, kept OUT of the engine. Nothing here changes a
running apply; the engine does not import it yet. It exists so the next tenant
is a folder, never a fork.

## The law

1. **One engine, many overlays.** A tenant is a `tenants/<id>/` folder + one
   `registry.js` row — never a second engine and never a `if (tenant===…)` in
   executor code. Capabilities route by widget fingerprint, not by tenant name.
2. **Platform beats tenant.** Most of what was learned on MDLZ belongs to
   **Workday**, not MDLZ — the same CXS front-end runs Maersk, LEGO, Hyatt. Put
   it under `platform/workday/`; only what actually differs goes in a tenant
   overlay.
3. **Provenance is mandatory.** Every capability, archetype, and tenant carries
   `measuredOn` (tenant, date, traces, result). An entry with no evidence is a
   guess, and `validate()` rejects it. When a Workday bundle update breaks an
   invariant, provenance is how you find the ONE entry to re-measure.
4. **Generalize only on n≥2.** A capability is `confirmed` once a SECOND tenant
   reused it without change; until then it is `unverified` — documented, not
   trusted as generic.

## Layout

```
platform/workday/
  archetype.js         the external-application grammar (steps, nav, structure)
  quirks.js            platform-wide measured behaviour (skillsearch, hidden tab, isolated world)
  capabilities/        one file per widget family: fingerprint → contract → recovery
  slots/               WHAT semantics: what a field means, its cardinality + taxonomy policy
tenants/<id>/
  signature.js         how to recognise this tenant
  field-sets.js        the fields each page actually renders (measured)
  quirks.js            tenant-specific deviations from the platform
  playbook.js          section order, policies, advance gate (specialised, allowed)
  evidence.js          provenance: traces, dates, samples, SHAs
registry.js            enabled tenants → their signature/playbook/overlay
schema.js              the entry shapes + validate() (provenance guard)
index.js               thin barrel + lookup helpers
```

## Adding a tenant (the whole checklist)

1. Dry-run the current engine on the tenant, **observe only** — never write.
2. Diff against `platform/workday`: what ran unchanged (→ votes a capability
   `confirmed`) vs what broke (→ a tenant quirk, or a new capability entry).
3. Write `tenants/<id>/` from the measured evidence.
4. Add one `registry.js` row (`enabled: false` until the engine is generalised
   for it).
5. Never copy MDLZ code. Generalization is *extracted* from the diff, not
   *written* ahead of it.
