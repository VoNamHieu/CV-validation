/** MDLZ overlay — the first proven tenant. Assembled from its focused parts. */
import { mdlzSignature } from './signature.js';
import { mdlzFieldSets } from './field-sets.js';
import { mdlzQuirks } from './quirks.js';
import { mdlzPlaybook } from './playbook.js';
import { mdlzEvidence } from './evidence.js';

export const mdlz = {
    id: 'mdlz',
    signature: mdlzSignature,
    fieldSets: mdlzFieldSets,
    quirks: mdlzQuirks,
    playbook: mdlzPlaybook,
    evidence: mdlzEvidence,
};
