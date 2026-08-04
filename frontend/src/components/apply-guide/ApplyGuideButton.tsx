'use client';

// Renders nothing unless the job's company has a guide (see the registry in
// lib/apply-guides). Callers pass their own `className` so the button inherits
// whatever button style that surface already uses.
import { useMemo, useState } from 'react';
import { BookOpen } from '@phosphor-icons/react';
import { resolveApplyGuide } from '@/lib/apply-guides';
import { track } from '@/lib/analytics';
import ApplyGuideModal from './ApplyGuideModal';

export default function ApplyGuideButton({
    company,
    className,
    source,
}: {
    company?: string | null;
    className?: string;
    /** Where the button was rendered — analytics only. */
    source?: string;
}) {
    const guide = useMemo(() => resolveApplyGuide(company), [company]);
    // Which guide the reader is open for, not a plain boolean: switching to a
    // job from another company that also has a guide would otherwise leave the
    // previous company's guide on screen.
    const [openFor, setOpenFor] = useState<string | null>(null);

    if (!guide) return null;

    return (
        <>
            <button
                type="button"
                className={className}
                onClick={() => {
                    setOpenFor(guide.id);
                    track('apply_guide_opened', { guide: guide.id, company, source });
                }}
            >
                <BookOpen size={16} weight="bold" /> {guide.label}
            </button>
            {openFor === guide.id && <ApplyGuideModal guide={guide} onClose={() => setOpenFor(null)} />}
        </>
    );
}
