/**
 * The knowledge library's public surface — a thin barrel, no logic of its own.
 * Nothing in the running engine imports this yet; it is data waiting for the
 * generalisation that a second enabled tenant will pull out.
 */
export { registry, tenantFor } from './registry.js';
export { workdayExternalApplication } from './platform/workday/archetype.js';
export { workdayQuirks } from './platform/workday/quirks.js';
export { capabilities, confirmedCapabilities, unverifiedCapabilities } from './platform/workday/capabilities/index.js';
export { slots } from './platform/workday/slots/index.js';
export { validate } from './schema.js';

import { registry } from './registry.js';
import { capabilities } from './platform/workday/capabilities/index.js';
import { workdayExternalApplication } from './platform/workday/archetype.js';
import { validate } from './schema.js';

/** Run the provenance guard over the whole library. Throws on any entry without evidence. */
export function validateKnowledge() {
    return validate({
        registry,
        capabilities,
        archetypes: { [workdayExternalApplication.id]: workdayExternalApplication },
    });
}
