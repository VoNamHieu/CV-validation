'use client';

import { useState, useCallback } from 'react';
import {
    PencilSimple, CheckCircle, Plus, X,
    ArrowCounterClockwise, FloppyDisk,
} from '@phosphor-icons/react';
import type { CVData, ExperienceDetail, EducationDetail, ProjectDetail } from '@/lib/types';

/* ═══════════════════════════════════════════════════════════════════════════════
   Professional CV Document Preview — looks like a real printed CV
   ═══════════════════════════════════════════════════════════════════════════════ */

/* ─── Section Header (clean line style) ─── */
function SectionHeader({ title }: { title: string }) {
    return (
        <div style={{
            borderBottom: '2px solid #222',
            paddingBottom: 6,
            marginBottom: 16,
            marginTop: 28,
        }}>
            <h3 style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: '#1a1a1a',
                margin: 0,
            }}>
                {title}
            </h3>
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
}: {
    value: string;
    onChange: (val: string) => void;
    multiline?: boolean;
    style?: React.CSSProperties;
    placeholder?: string;
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
                        width: '100%',
                        minHeight: 60,
                        resize: 'vertical',
                        padding: '8px 10px',
                        border: '1.5px solid #6366f1',
                        borderRadius: 6,
                        fontSize: 'inherit',
                        fontFamily: 'inherit',
                        lineHeight: 'inherit',
                        color: '#1a1a1a',
                        background: '#f8f9ff',
                        outline: 'none',
                        boxShadow: '0 0 0 3px rgba(99,102,241,0.1)',
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
                    width: '100%',
                    padding: '4px 8px',
                    border: '1.5px solid #6366f1',
                    borderRadius: 4,
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    fontWeight: 'inherit',
                    color: '#1a1a1a',
                    background: '#f8f9ff',
                    outline: 'none',
                    boxShadow: '0 0 0 3px rgba(99,102,241,0.1)',
                    ...extraStyle,
                }}
            />
        );
    }

    return (
        <span
            onClick={() => setEditing(true)}
            style={{
                cursor: 'text',
                borderRadius: 4,
                padding: '2px 4px',
                margin: '-2px -4px',
                transition: 'background 0.15s',
                display: multiline ? 'block' : 'inline',
                ...extraStyle,
            }}
            className="cv-editable-text"
            title="Click to edit"
        >
            {value || <span style={{ color: '#999', fontStyle: 'italic' }}>{placeholder || 'Click to edit...'}</span>}
        </span>
    );
}

/* ─── Skills tags with add/remove ─── */
function SkillsTags({
    skills,
    originalSkills,
    onChange,
}: {
    skills: string[];
    originalSkills: string[];
    onChange: (skills: string[]) => void;
}) {
    const [newSkill, setNewSkill] = useState('');
    const [adding, setAdding] = useState(false);
    const originalSet = new Set(originalSkills.map(s => s.toLowerCase()));

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
                return (
                    <span key={i} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 10px', borderRadius: 4, fontSize: '0.82rem',
                        background: isNew ? '#e8f5e9' : '#f5f5f5',
                        border: `1px solid ${isNew ? '#81c784' : '#e0e0e0'}`,
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
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } if (e.key === 'Escape') setAdding(false); }}
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

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT — CV Document Preview
   ═══════════════════════════════════════════════════════════════════════════════ */

interface CvDocumentPreviewProps {
    originalCv: CVData;
    optimizedCv: CVData;
    onSave: (editedCv: CVData) => void;
    compact?: boolean; // for batch view, slightly smaller
}

export default function CvDocumentPreview({
    originalCv, optimizedCv, onSave, compact = false
}: CvDocumentPreviewProps) {
    const [edited, setEdited] = useState<CVData>(() => JSON.parse(JSON.stringify(optimizedCv)));
    const [hasChanges, setHasChanges] = useState(false);

    const update = useCallback(<K extends keyof CVData>(field: K, value: CVData[K]) => {
        setEdited(prev => ({ ...prev, [field]: value }));
        setHasChanges(true);
    }, []);

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

    const pagePadding = compact ? '32px 36px' : '48px 56px';

    return (
        <div style={{ position: 'relative' }}>
            {/* Floating action bar */}
            <div style={{
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
                            fontWeight: 700,
                            color: '#111',
                            letterSpacing: '-0.02em',
                            textAlign: 'center',
                        }}
                    />
                </div>

                {/* ── MỤC TIÊU NGHỀ NGHIỆP (Summary) ── */}
                <SectionHeader title="MỤC TIÊU NGHỀ NGHIỆP" />
                <div style={{
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    padding: '12px 16px',
                    marginBottom: 4,
                    background: '#fafafa',
                }}>
                    <InlineEdit
                        value={edited.summary}
                        onChange={(v) => update('summary', v)}
                        multiline
                        style={{
                            fontSize: '0.92rem',
                            color: '#333',
                            lineHeight: 1.65,
                        }}
                        placeholder="Write your professional summary..."
                    />
                </div>

                {/* ── HỌC VẤN (Education) ── */}
                <SectionHeader title="HỌC VẤN" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(edited.education || []).map((edu, i) => (
                        <div key={i} style={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr',
                            gap: 16,
                            alignItems: 'start',
                        }}>
                            {/* Year */}
                            <div style={{ color: '#555', fontSize: '0.88rem' }}>
                                <InlineEdit
                                    value={edu.year}
                                    onChange={(v) => updateEducation(i, 'year', v)}
                                    placeholder="Year"
                                />
                            </div>
                            {/* Institution & Degree */}
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
                        </div>
                    ))}
                </div>

                {/* ── KỸ NĂNG (Skills) ── */}
                <SectionHeader title="KỸ NĂNG" />
                <SkillsTags
                    skills={edited.skills}
                    originalSkills={originalCv.skills}
                    onChange={(s) => update('skills', s)}
                />

                {/* ── KINH NGHIỆM LÀM VIỆC (Experience) ── */}
                <SectionHeader title="KINH NGHIỆM LÀM VIỆC" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {(edited.experience || []).map((exp, i) => (
                        <div key={i} style={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr',
                            gap: 16,
                            alignItems: 'start',
                        }}>
                            {/* Duration */}
                            <div style={{ color: '#555', fontSize: '0.88rem', lineHeight: 1.5 }}>
                                <span>{exp.duration_months} months</span>
                            </div>

                            {/* Title, Company, Description */}
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
                                {/* Description as bullet points */}
                                <div style={{ paddingLeft: 4, fontSize: '0.88rem', color: '#333', lineHeight: 1.65 }}>
                                    <InlineEdit
                                        value={exp.description}
                                        onChange={(v) => updateExperience(i, 'description', v)}
                                        multiline
                                        placeholder="Describe your responsibilities and achievements..."
                                        style={{ whiteSpace: 'pre-wrap' }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── DỰ ÁN (Projects) ── */}
                {(edited.projects || []).length > 0 && (
                    <>
                        <SectionHeader title="DỰ ÁN" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {edited.projects.map((proj, i) => (
                                <div key={i}>
                                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#111', marginBottom: 4 }}>
                                        <InlineEdit
                                            value={proj.name}
                                            onChange={(v) => updateProject(i, 'name', v)}
                                            placeholder="Project Name"
                                        />
                                    </div>
                                    <div style={{ fontSize: '0.88rem', color: '#333', lineHeight: 1.6, paddingLeft: 4 }}>
                                        <InlineEdit
                                            value={proj.description}
                                            onChange={(v) => updateProject(i, 'description', v)}
                                            multiline
                                            placeholder="Describe the project..."
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

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

            {/* Hover styles for editable fields */}
            <style>{`
                .cv-editable-text:hover {
                    background: rgba(99, 102, 241, 0.06) !important;
                    outline: 1px dashed rgba(99, 102, 241, 0.3);
                }
                .cv-skill-remove {
                    opacity: 0;
                    transition: opacity 0.15s;
                }
                .cv-skill-remove:hover {
                    color: #e53935 !important;
                }
                span:hover > .cv-skill-remove {
                    opacity: 1;
                }
                .cv-add-skill-btn:hover {
                    border-color: #6366f1 !important;
                    color: #6366f1 !important;
                }
                @media print {
                    .cv-document {
                        box-shadow: none !important;
                        border-radius: 0 !important;
                        padding: 0 !important;
                    }
                }
            `}</style>
        </div>
    );
}
