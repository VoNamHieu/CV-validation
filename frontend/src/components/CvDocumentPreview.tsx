'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
    Plus, X, ArrowCounterClockwise, FloppyDisk, Printer,
    ArrowUp, ArrowDown, Trash,
} from '@phosphor-icons/react';
import type { CVData, ExperienceDetail, EducationDetail, ProjectDetail } from '@/lib/types';

/* ═══════════════════════════════════════════════════════════════════════════════
   Professional CV Document Preview — looks like a real printed CV
   ═══════════════════════════════════════════════════════════════════════════════ */

/* ─── Bullet helpers ─── */
function parseBullets(value: string): string[] {
    if (!value) return [];
    return value.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, ''));
}
function serializeBullets(bullets: string[]): string {
    return bullets.join('\n');
}

/* ─── ATS keyword highlighting ─── */
function escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function HighlightedText({ text, keywords }: { text: string; keywords?: string[] }) {
    if (!keywords || keywords.length === 0 || !text) return <>{text}</>;
    const cleanKws = keywords
        .map(k => k.trim())
        .filter(k => k.length >= 2)
        .sort((a, b) => b.length - a.length); // match longest first
    if (cleanKws.length === 0) return <>{text}</>;
    const re = new RegExp(`(${cleanKws.map(escapeRegex).join('|')})`, 'gi');
    const parts = text.split(re);
    return (
        <>
            {parts.map((p, i) =>
                i % 2 === 1
                    ? <mark key={i} className="ats-kw">{p}</mark>
                    : <span key={i}>{p}</span>
            )}
        </>
    );
}

/* ─── Section Header (clean line style) ─── */
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
    return (
        <div style={{
            borderBottom: '2px solid #222',
            paddingBottom: 6,
            marginBottom: 16,
            marginTop: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
            <h3 style={{
                fontSize: '0.85rem', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                color: '#1a1a1a', margin: 0,
            }}>
                {title}
            </h3>
            {action && <div className="cv-section-action">{action}</div>}
        </div>
    );
}

/* ─── Inline editable text (appears as plain text until hover/click) ─── */
function InlineEdit({
    value,
    onChange,
    multiline = false,
    style: extraStyle = {},
    placeholder = '',
    keywords,
}: {
    value: string;
    onChange: (val: string) => void;
    multiline?: boolean;
    style?: React.CSSProperties;
    placeholder?: string;
    keywords?: string[];
}) {
    const [editing, setEditing] = useState(false);

    if (editing) {
        if (multiline) {
            return (
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => setEditing(false)}
                    autoFocus
                    placeholder={placeholder}
                    style={{
                        width: '100%', minHeight: 60, resize: 'vertical',
                        padding: '8px 10px',
                        border: '1.5px solid #6366f1', borderRadius: 6,
                        fontSize: 'inherit', fontFamily: 'inherit', lineHeight: 'inherit',
                        color: '#1a1a1a', background: '#f8f9ff',
                        outline: 'none', boxShadow: '0 0 0 3px rgba(99,102,241,0.1)',
                        ...extraStyle,
                    }}
                />
            );
        }
        return (
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditing(false); }}
                autoFocus
                placeholder={placeholder}
                style={{
                    width: '100%', padding: '4px 8px',
                    border: '1.5px solid #6366f1', borderRadius: 4,
                    fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 'inherit',
                    color: '#1a1a1a', background: '#f8f9ff',
                    outline: 'none', boxShadow: '0 0 0 3px rgba(99,102,241,0.1)',
                    ...extraStyle,
                }}
            />
        );
    }

    return (
        <span
            onClick={() => setEditing(true)}
            style={{
                cursor: 'text', borderRadius: 4,
                padding: '2px 4px', margin: '-2px -4px',
                transition: 'background 0.15s',
                display: multiline ? 'block' : 'inline',
                ...extraStyle,
            }}
            className="cv-editable-text"
            title="Click to edit"
        >
            {value
                ? <HighlightedText text={value} keywords={keywords} />
                : <span style={{ color: '#999', fontStyle: 'italic' }}>{placeholder || 'Click to edit...'}</span>}
        </span>
    );
}

/* ─── Bullet point editor for descriptions ─── */
function BulletEditor({
    value,
    onChange,
    placeholder,
    keywords,
}: {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    keywords?: string[];
}) {
    const bullets = useMemo(() => parseBullets(value), [value]);

    const updateBullet = (idx: number, text: string) => {
        const next = [...bullets];
        next[idx] = text;
        onChange(serializeBullets(next));
    };
    const removeBullet = (idx: number) => {
        onChange(serializeBullets(bullets.filter((_, i) => i !== idx)));
    };
    const addBullet = () => {
        onChange(serializeBullets([...bullets, '']));
    };
    const move = (idx: number, dir: -1 | 1) => {
        const target = idx + dir;
        if (target < 0 || target >= bullets.length) return;
        const next = [...bullets];
        [next[idx], next[target]] = [next[target], next[idx]];
        onChange(serializeBullets(next));
    };

    if (bullets.length === 0) {
        return (
            <button
                onClick={addBullet}
                className="cv-add-bullet-btn"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 4, fontSize: '0.78rem',
                    background: 'transparent', border: '1px dashed #ccc',
                    color: '#888', cursor: 'pointer',
                }}
            >
                <Plus size={10} /> {placeholder || 'Add detail'}
            </button>
        );
    }

    return (
        <ul className="cv-bullets" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {bullets.map((b, i) => (
                <li key={i} className="cv-bullet-row" style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    padding: '2px 0',
                }}>
                    <span aria-hidden style={{ color: '#444', marginTop: 1, flexShrink: 0 }}>•</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <InlineEdit
                            value={b}
                            onChange={(v) => updateBullet(i, v)}
                            placeholder="Add detail…"
                            keywords={keywords}
                            multiline={false}
                        />
                    </span>
                    <span className="cv-bullet-actions" style={{
                        display: 'inline-flex', gap: 2, flexShrink: 0,
                        opacity: 0, transition: 'opacity 0.15s',
                    }}>
                        <IconBtn title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                            <ArrowUp size={11} />
                        </IconBtn>
                        <IconBtn title="Move down" onClick={() => move(i, 1)} disabled={i === bullets.length - 1}>
                            <ArrowDown size={11} />
                        </IconBtn>
                        <IconBtn title="Remove bullet" onClick={() => removeBullet(i)} danger>
                            <X size={11} />
                        </IconBtn>
                    </span>
                </li>
            ))}
            <li>
                <button
                    onClick={addBullet}
                    className="cv-add-bullet-btn"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 4, fontSize: '0.75rem',
                        background: 'transparent', border: '1px dashed #ccc',
                        color: '#888', cursor: 'pointer', marginTop: 4,
                    }}
                >
                    <Plus size={10} /> Add bullet
                </button>
            </li>
        </ul>
    );
}

/* ─── Small icon-only button ─── */
function IconBtn({
    children, onClick, title, disabled, danger,
}: {
    children: React.ReactNode;
    onClick: () => void;
    title: string;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            disabled={disabled}
            style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 4, padding: 0,
                background: 'transparent',
                border: '1px solid #ddd',
                color: danger ? '#c0392b' : '#555',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.3 : 1,
                transition: 'background 0.15s',
            }}
            className="cv-icon-btn"
        >
            {children}
        </button>
    );
}

/* ─── Skills tags with add/remove ─── */
function SkillsTags({
    skills,
    originalSkills,
    onChange,
    keywords,
}: {
    skills: string[];
    originalSkills: string[];
    onChange: (skills: string[]) => void;
    keywords?: string[];
}) {
    const [newSkill, setNewSkill] = useState('');
    const [adding, setAdding] = useState(false);
    const originalSet = new Set(originalSkills.map(s => s.toLowerCase()));
    const matchSet = new Set((keywords || []).map(k => k.toLowerCase()));

    const addSkill = () => {
        const trimmed = newSkill.trim();
        if (trimmed && !skills.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
            onChange([...skills, trimmed]);
            setNewSkill('');
        }
    };

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {skills.map((skill, i) => {
                const isNew = !originalSet.has(skill.toLowerCase());
                const isAtsMatch = matchSet.size > 0 && [...matchSet].some(k => skill.toLowerCase().includes(k));
                return (
                    <span key={i} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 4, fontSize: '0.82rem',
                        background: isAtsMatch ? '#fff7d6' : isNew ? '#e8f5e9' : '#f5f5f5',
                        border: `1px solid ${isAtsMatch ? '#f59e0b' : isNew ? '#81c784' : '#e0e0e0'}`,
                        color: '#333',
                        fontWeight: 500,
                    }}>
                        {skill}
                        <button
                            onClick={() => onChange(skills.filter((_, idx) => idx !== i))}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: 0, display: 'flex', color: '#999',
                                marginLeft: 2,
                            }}
                            className="cv-skill-remove"
                            title="Remove skill"
                        >
                            <X size={10} />
                        </button>
                    </span>
                );
            })}
            {adding ? (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                    <input
                        type="text"
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
                            if (e.key === 'Escape') setAdding(false);
                        }}
                        autoFocus
                        onBlur={() => { if (!newSkill.trim()) setAdding(false); }}
                        placeholder="Skill name..."
                        style={{
                            width: 120, padding: '3px 8px', fontSize: '0.82rem',
                            border: '1.5px solid #6366f1', borderRadius: 4,
                            outline: 'none', color: '#1a1a1a', background: '#f8f9ff',
                        }}
                    />
                    <button
                        onClick={() => { addSkill(); }}
                        style={{
                            background: '#6366f1', color: 'white', border: 'none',
                            borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                            fontSize: '0.75rem', fontWeight: 600,
                        }}
                    >
                        Add
                    </button>
                </span>
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        padding: '3px 10px', borderRadius: 4, fontSize: '0.78rem',
                        background: 'transparent', border: '1px dashed #ccc',
                        color: '#888', cursor: 'pointer',
                        transition: 'all 0.15s',
                    }}
                    className="cv-add-skill-btn"
                >
                    <Plus size={10} /> Add skill
                </button>
            )}
        </div>
    );
}

/* ─── Item action bar (move up/down + delete) ─── */
function ItemActions({
    onUp, onDown, onRemove, isFirst, isLast,
}: {
    onUp: () => void;
    onDown: () => void;
    onRemove: () => void;
    isFirst: boolean;
    isLast: boolean;
}) {
    return (
        <div className="cv-item-actions" style={{
            display: 'inline-flex', gap: 4, opacity: 0, transition: 'opacity 0.15s',
        }}>
            <IconBtn title="Move up" onClick={onUp} disabled={isFirst}><ArrowUp size={11} /></IconBtn>
            <IconBtn title="Move down" onClick={onDown} disabled={isLast}><ArrowDown size={11} /></IconBtn>
            <IconBtn title="Remove" onClick={onRemove} danger><Trash size={11} /></IconBtn>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT — CV Document Preview
   ═══════════════════════════════════════════════════════════════════════════════ */

interface CvDocumentPreviewProps {
    originalCv: CVData;
    optimizedCv: CVData;
    onSave: (editedCv: CVData) => void;
    /** Notifies the parent of the latest edited CV so the template preview /
     *  download can use in-progress edits, not just the saved optimizedCv. */
    onEditedChange?: (editedCv: CVData) => void;
    keywords?: string[]; // ATS must-have keywords for highlighting
    compact?: boolean;
}

const EMPTY_EXPERIENCE: ExperienceDetail = { title: '', company: '', duration_months: 0, description: '' };
const EMPTY_EDUCATION: EducationDetail = { degree: '', institution: '', year: '' };
const EMPTY_PROJECT: ProjectDetail = { name: '', description: '' };

export default function CvDocumentPreview({
    originalCv, optimizedCv, onSave, onEditedChange, keywords, compact = false,
}: CvDocumentPreviewProps) {
    const [edited, setEdited] = useState<CVData>(() => JSON.parse(JSON.stringify(optimizedCv)));
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        onEditedChange?.(edited);
    }, [edited, onEditedChange]);

    // A genuinely new optimized CV (re-optimize, variant switch) replaces the
    // edited content — the latest optimization is the default. Unrelated entry
    // updates (template/avatar changes) keep the same optimizedCv reference,
    // so in-progress edits survive them.
    const [syncedCv, setSyncedCv] = useState(optimizedCv);
    if (syncedCv !== optimizedCv) {
        setSyncedCv(optimizedCv);
        setEdited(JSON.parse(JSON.stringify(optimizedCv)));
        setHasChanges(false);
    }

    const update = useCallback(<K extends keyof CVData>(field: K, value: CVData[K]) => {
        setEdited(prev => ({ ...prev, [field]: value }));
        setHasChanges(true);
    }, []);

    /* Generic list helpers */
    const moveItem = (field: 'experience' | 'education' | 'projects', idx: number, dir: -1 | 1) => {
        setEdited(prev => {
            const list = [...(prev[field] as unknown[])];
            const target = idx + dir;
            if (target < 0 || target >= list.length) return prev;
            [list[idx], list[target]] = [list[target], list[idx]];
            return { ...prev, [field]: list as CVData[typeof field] };
        });
        setHasChanges(true);
    };
    const removeItem = (field: 'experience' | 'education' | 'projects', idx: number) => {
        setEdited(prev => {
            const list = (prev[field] as unknown[]).filter((_, i) => i !== idx);
            return { ...prev, [field]: list as CVData[typeof field] };
        });
        setHasChanges(true);
    };
    const addItem = (field: 'experience' | 'education' | 'projects') => {
        setEdited(prev => {
            const empty = field === 'experience' ? EMPTY_EXPERIENCE
                : field === 'education' ? EMPTY_EDUCATION
                : EMPTY_PROJECT;
            const list = [...(prev[field] as unknown[]), { ...empty }];
            return { ...prev, [field]: list as CVData[typeof field] };
        });
        setHasChanges(true);
    };

    /* Field-level helpers (typed) */
    const updateExperience = useCallback((idx: number, field: keyof ExperienceDetail, value: string | number) => {
        setEdited(prev => {
            const updated = [...prev.experience];
            updated[idx] = { ...updated[idx], [field]: value };
            return { ...prev, experience: updated };
        });
        setHasChanges(true);
    }, []);

    const updateEducation = useCallback((idx: number, field: keyof EducationDetail, value: string) => {
        setEdited(prev => {
            const updated = [...prev.education];
            updated[idx] = { ...updated[idx], [field]: value };
            return { ...prev, education: updated };
        });
        setHasChanges(true);
    }, []);

    const updateProject = useCallback((idx: number, field: keyof ProjectDetail, value: string) => {
        setEdited(prev => {
            const updated = [...prev.projects];
            updated[idx] = { ...updated[idx], [field]: value };
            return { ...prev, projects: updated };
        });
        setHasChanges(true);
    }, []);

    const revertAll = () => {
        setEdited(JSON.parse(JSON.stringify(optimizedCv)));
        setHasChanges(false);
    };

    const handlePrint = () => window.print();

    const pagePadding = compact ? '32px 36px' : '48px 56px';

    return (
        <div style={{ position: 'relative' }}>
            {/* Floating action bar */}
            <div className="cv-action-bar" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                gap: 8, marginBottom: 12,
            }}>
                {hasChanges && (
                    <button
                        onClick={revertAll}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '6px 14px', borderRadius: 8,
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem',
                        }}
                    >
                        <ArrowCounterClockwise size={12} /> Revert
                    </button>
                )}
                <button
                    onClick={handlePrint}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '8px 16px', fontSize: '0.82rem', borderRadius: 8,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)', cursor: 'pointer',
                    }}
                    title="Print to PDF (use the system print dialog)"
                >
                    <Printer size={14} /> Print PDF
                </button>
                <button
                    onClick={() => onSave(edited)}
                    className="btn-primary"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '8px 20px', fontSize: '0.82rem',
                    }}
                >
                    <FloppyDisk size={14} weight="fill" /> Save & Download
                </button>
            </div>

            {/* The CV Document — white paper */}
            <div
                className="cv-document"
                style={{
                    background: '#ffffff',
                    color: '#1a1a1a',
                    borderRadius: 8,
                    padding: pagePadding,
                    boxShadow: '0 2px 20px rgba(0,0,0,0.15), 0 0 1px rgba(0,0,0,0.1)',
                    fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
                    fontSize: compact ? '10pt' : '10.5pt',
                    lineHeight: 1.6,
                    maxWidth: compact ? 720 : 820,
                    margin: '0 auto',
                    position: 'relative',
                }}
            >
                {/* ── Name ── */}
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                    <InlineEdit
                        value={edited.name}
                        onChange={(v) => update('name', v)}
                        style={{
                            fontSize: compact ? '1.5rem' : '1.8rem',
                            fontWeight: 700, color: '#111',
                            letterSpacing: '-0.02em', textAlign: 'center',
                        }}
                    />
                </div>

                {/* ── MỤC TIÊU NGHỀ NGHIỆP (Summary) ── */}
                <SectionHeader title="MỤC TIÊU NGHỀ NGHIỆP" />
                <div style={{
                    border: '1px solid #ddd', borderRadius: 4,
                    padding: '12px 16px', marginBottom: 4,
                    background: '#fafafa',
                }}>
                    <InlineEdit
                        value={edited.summary}
                        onChange={(v) => update('summary', v)}
                        multiline
                        keywords={keywords}
                        style={{ fontSize: '0.92rem', color: '#333', lineHeight: 1.65 }}
                        placeholder="Write your professional summary..."
                    />
                </div>

                {/* ── HỌC VẤN (Education) ── */}
                <SectionHeader
                    title="HỌC VẤN"
                    action={
                        <button
                            onClick={() => addItem('education')}
                            className="cv-section-add-btn"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem',
                                background: 'transparent', border: '1px dashed #ccc',
                                color: '#888', cursor: 'pointer',
                            }}
                        >
                            <Plus size={10} /> Add
                        </button>
                    }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(edited.education || []).map((edu, i) => (
                        <div key={i} className="cv-item" style={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr auto',
                            gap: 16,
                            alignItems: 'start',
                        }}>
                            <div style={{ color: '#555', fontSize: '0.88rem' }}>
                                <InlineEdit
                                    value={edu.year}
                                    onChange={(v) => updateEducation(i, 'year', v)}
                                    placeholder="Year"
                                />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#111' }}>
                                    <InlineEdit
                                        value={edu.institution}
                                        onChange={(v) => updateEducation(i, 'institution', v)}
                                        placeholder="Institution"
                                    />
                                </div>
                                <div style={{ color: '#444', fontSize: '0.88rem' }}>
                                    <InlineEdit
                                        value={edu.degree}
                                        onChange={(v) => updateEducation(i, 'degree', v)}
                                        placeholder="Degree"
                                    />
                                </div>
                            </div>
                            <ItemActions
                                onUp={() => moveItem('education', i, -1)}
                                onDown={() => moveItem('education', i, 1)}
                                onRemove={() => removeItem('education', i)}
                                isFirst={i === 0}
                                isLast={i === (edited.education?.length ?? 0) - 1}
                            />
                        </div>
                    ))}
                </div>

                {/* ── KỸ NĂNG (Skills) ── */}
                <SectionHeader title="KỸ NĂNG" />
                <SkillsTags
                    skills={edited.skills}
                    originalSkills={originalCv.skills}
                    onChange={(s) => update('skills', s)}
                    keywords={keywords}
                />

                {/* ── KINH NGHIỆM LÀM VIỆC (Experience) ── */}
                <SectionHeader
                    title="KINH NGHIỆM LÀM VIỆC"
                    action={
                        <button
                            onClick={() => addItem('experience')}
                            className="cv-section-add-btn"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem',
                                background: 'transparent', border: '1px dashed #ccc',
                                color: '#888', cursor: 'pointer',
                            }}
                        >
                            <Plus size={10} /> Add
                        </button>
                    }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {(edited.experience || []).map((exp, i) => (
                        <div key={i} className="cv-item" style={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr auto',
                            gap: 16,
                            alignItems: 'start',
                        }}>
                            <div style={{ color: '#555', fontSize: '0.88rem', lineHeight: 1.5 }}>
                                <InlineEdit
                                    value={String(exp.duration_months ?? 0)}
                                    onChange={(v) => updateExperience(i, 'duration_months', parseInt(v, 10) || 0)}
                                    placeholder="0"
                                    style={{ display: 'inline' }}
                                />
                                <span style={{ marginLeft: 4 }}>months</span>
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#111' }}>
                                    <InlineEdit
                                        value={exp.title}
                                        onChange={(v) => updateExperience(i, 'title', v)}
                                        placeholder="Job Title"
                                    />
                                </div>
                                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#333', marginBottom: 6 }}>
                                    <InlineEdit
                                        value={exp.company}
                                        onChange={(v) => updateExperience(i, 'company', v)}
                                        placeholder="Company"
                                    />
                                </div>
                                <div style={{ paddingLeft: 0, fontSize: '0.88rem', color: '#333', lineHeight: 1.65 }}>
                                    <BulletEditor
                                        value={exp.description}
                                        onChange={(v) => updateExperience(i, 'description', v)}
                                        keywords={keywords}
                                        placeholder="Add achievement"
                                    />
                                </div>
                            </div>
                            <ItemActions
                                onUp={() => moveItem('experience', i, -1)}
                                onDown={() => moveItem('experience', i, 1)}
                                onRemove={() => removeItem('experience', i)}
                                isFirst={i === 0}
                                isLast={i === (edited.experience?.length ?? 0) - 1}
                            />
                        </div>
                    ))}
                </div>

                {/* ── DỰ ÁN (Projects) ── */}
                <SectionHeader
                    title="DỰ ÁN"
                    action={
                        <button
                            onClick={() => addItem('projects')}
                            className="cv-section-add-btn"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem',
                                background: 'transparent', border: '1px dashed #ccc',
                                color: '#888', cursor: 'pointer',
                            }}
                        >
                            <Plus size={10} /> Add
                        </button>
                    }
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {(edited.projects || []).map((proj, i) => (
                        <div key={i} className="cv-item" style={{
                            display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start',
                        }}>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#111', marginBottom: 4 }}>
                                    <InlineEdit
                                        value={proj.name}
                                        onChange={(v) => updateProject(i, 'name', v)}
                                        placeholder="Project Name"
                                    />
                                </div>
                                <div style={{ fontSize: '0.88rem', color: '#333', lineHeight: 1.6, paddingLeft: 0 }}>
                                    <BulletEditor
                                        value={proj.description}
                                        onChange={(v) => updateProject(i, 'description', v)}
                                        keywords={keywords}
                                        placeholder="Add detail"
                                    />
                                </div>
                            </div>
                            <ItemActions
                                onUp={() => moveItem('projects', i, -1)}
                                onDown={() => moveItem('projects', i, 1)}
                                onRemove={() => removeItem('projects', i)}
                                isFirst={i === 0}
                                isLast={i === (edited.projects?.length ?? 0) - 1}
                            />
                        </div>
                    ))}
                </div>

                {/* AI disclaimer watermark */}
                <div style={{
                    marginTop: 32, paddingTop: 12,
                    borderTop: '1px solid #eee',
                    fontSize: '0.7rem', color: '#bbb',
                    textAlign: 'center',
                }}>
                    AI-assisted optimization · Generated by JobFit AI
                </div>
            </div>

            <style>{`
                .cv-editable-text:hover {
                    background: rgba(99, 102, 241, 0.06) !important;
                    outline: 1px dashed rgba(99, 102, 241, 0.3);
                }
                .cv-skill-remove { opacity: 0; transition: opacity 0.15s; }
                .cv-skill-remove:hover { color: #e53935 !important; }
                span:hover > .cv-skill-remove { opacity: 1; }
                .cv-add-skill-btn:hover { border-color: #6366f1 !important; color: #6366f1 !important; }
                .cv-add-bullet-btn:hover { border-color: #6366f1 !important; color: #6366f1 !important; }

                .cv-bullet-row:hover .cv-bullet-actions { opacity: 1; }
                .cv-item:hover .cv-item-actions { opacity: 1; }
                .cv-icon-btn:hover:not(:disabled) { background: #f3f4f6; }

                .ats-kw {
                    background: #fff7d6;
                    color: inherit;
                    padding: 0 2px;
                    border-radius: 2px;
                    box-shadow: inset 0 -1px 0 #f59e0b;
                }

                @media print {
                    body * { visibility: hidden; }
                    .cv-document, .cv-document * { visibility: visible; }
                    .cv-document {
                        position: absolute !important;
                        left: 0 !important; top: 0 !important;
                        width: 100% !important; max-width: none !important;
                        box-shadow: none !important;
                        border-radius: 0 !important;
                        padding: 24mm 18mm !important;
                    }
                    .cv-action-bar, .cv-section-action,
                    .cv-section-add-btn, .cv-bullet-actions,
                    .cv-item-actions, .cv-add-skill-btn,
                    .cv-add-bullet-btn, .cv-skill-remove,
                    .cv-icon-btn { display: none !important; }
                    .ats-kw { background: transparent !important; box-shadow: none !important; }
                }
            `}</style>
        </div>
    );
}
