/**
 * hidden-file-upload — the résumé / attachment control. The visible button is a
 * proxy; the real <input type=file> is hidden and driven directly. The engine
 * syncs the CV PDF into extension storage and feeds it here.
 */

/** @type {import('../../../schema.js').Capability} */
export const hiddenFileUpload = {
    id: 'hidden-file-upload',

    fingerprint: { control: 'input[type=file] (hidden), fronted by a visible upload button', cardinality: 'one' },

    activate: ['locate the hidden input (the visible button only proxies it)'],
    read: ['the attachment list / filename that appears after upload'],
    decide: 'the CV file already synced to extension storage (cvFileBase64/cvFileName)',
    commit: ['set the file on the hidden input via a DataTransfer + change event'],
    verify: 'the uploaded filename appears in the resume/attachments list',
    recovery: ['re-upload'],

    invariants: [
        'Workday parses the résumé server-side and may RE-RENDER the page from it — expect fields to change under the agent after upload',
    ],
    antiPatterns: ['clicking the visible button and waiting for an OS file dialog (a dialog blocks the agent)'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-01', traces: ['R-174102'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // My Experience résumé upload ran on both
};
