/**
 * The semantic slot catalogue — WHAT each known field means. A slot binds a CV
 * source to a cardinality, a vocabulary, a taxonomy policy, and the capability
 * that fills it. WHAT may know the field is "skills" or "degree"; HOW
 * (the capability) never does.
 */

import { skillsSlot } from './skills.js';
import { fieldOfStudySlot } from './field-of-study.js';
import { degreeSlot, languageSlot } from './degree-and-language.js';

export const slots = Object.fromEntries(
    [skillsSlot, fieldOfStudySlot, degreeSlot, languageSlot].map((s) => [s.id, s]),
);
