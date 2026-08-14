/** Maersk overlay — tenant #2, dry-run measured. Assembled from its parts. */
import { maerskSignature } from './signature.js';
import { maerskFieldSets } from './field-sets.js';
import { maerskQuirks } from './quirks.js';
import { maerskPlaybook } from './playbook.js';
import { maerskEvidence } from './evidence.js';

export const maersk = {
    id: 'maersk',
    signature: maerskSignature,
    fieldSets: maerskFieldSets,
    quirks: maerskQuirks,
    playbook: maerskPlaybook,
    evidence: maerskEvidence,
};
