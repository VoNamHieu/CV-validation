/**
 * The capability catalogue + a fingerprint resolver. Capabilities route by the
 * runtime SHAPE (and, where two shapes are byte-identical, by the plan's
 * contract) — never by tenant or field name. That property is what lets one
 * engine serve every tenant, so it is asserted, not assumed.
 */

import { chipSearchMulti } from './chip-search-multi.js';
import { chipSearchSingle } from './chip-search-single.js';
import { portalListboxSelect } from './portal-listbox-select.js';
import { ladderSelect } from './ladder-select.js';
import { calendarDate } from './calendar-date.js';
import { controlledText } from './controlled-text.js';
import { radioLabel, checkboxControlled } from './radio-and-checkbox.js';
import { hiddenFileUpload } from './hidden-file-upload.js';
import { repeatableRows } from './repeatable-rows.js';

/** All capabilities, keyed by id. */
export const capabilities = Object.fromEntries(
    [
        chipSearchMulti, chipSearchSingle, portalListboxSelect, ladderSelect,
        calendarDate, controlledText, radioLabel, checkboxControlled,
        hiddenFileUpload, repeatableRows,
    ].map((c) => [c.id, c]),
);

/** confirmed = a 2nd tenant reused it unchanged; the rest are documented, not yet trusted generic. */
export const confirmedCapabilities = Object.values(capabilities).filter((c) => c.status === 'confirmed').map((c) => c.id);
export const unverifiedCapabilities = Object.values(capabilities).filter((c) => c.status !== 'confirmed').map((c) => c.id);
