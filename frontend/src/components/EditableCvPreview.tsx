'use client';

import { useState, useCallback } from 'react';
import {
    CaretDown, CaretUp, ArrowCounterClockwise, Plus, X,
    PencilSimple, CheckCircle, Briefcase, GraduationCap,
    Lightbulb, User, ListBullets,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { CVData, ExperienceDetail, EducationDetail, ProjectDetail } from '@/lib/types';

/* ─── Diff utility: simple word-level diff highlight ─── */
function DiffText({ original, current }: { original: string; current: string }) {
    if (original === current) {
        return <span>{current}</span>;
    }
    // Simple approach: if text changed, show with green background
    return (
        <span style={{
            background: 'rgba(16, 185, 129, 0.1)',
            borderLeft: '2px solid var(--accent-green)',
            paddingLeft: 6,
            display: 'block',
        }}>
            {current}
        </span>
    );
}

/* ─── Collapsible Section Wrapper ─── */
function Section({
    title,
    icon: IconComp,
    isChanged,
    onRevert,
    defaultOpen = true,
    children,
}: {
    title: string;
    icon: Icon;
    isChanged: boolean;
    onRevert: () => void;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{
            marginBottom: 2,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
        }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '14px 18px', background: 'var(--bg-secondary)', border: 'none',
                    cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.9rem',
                    fontWeight: 600,
                }}
            >
                <IconComp size={18} weight="duotone" style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
                {isChanged && (
                    <span
                        onClick={(e) => { e.stopPropagation(); onRevert(); }}
                        title="Khôi phục bản gốc"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '3px 10px', borderRadius: 12,
                            background: 'rgba(245,158,11,0.1)', color: 'var(--accent-amber)',
                            fontSize: '0.7rem', fontWeight: 500, cursor: 'pointer',
                            border: '1px solid rgba(245,158,11,0.2)',
                        }}
                    >
                        <ArrowCounterClockwise size={10} /> Khôi phục
                    </span>
                )}
                {isChanged && (
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: 'var(--accent-green)', flexShrink: 0,
                    }} title="Đã được AI chỉnh sửa" />
                )}
                {open ? <CaretUp size={14} style={{ color: 'var(--text-muted)' }} /> : <CaretDown size={14} style={{ color: 'var(--text-muted)' }} />}
            </button>
            {open && (
                <div style={{ padding: '16px 18px', background: 'var(--bg-card)' }}>
                    {children}
                </div>
            )}
        </div>
    );
}

/* ─── Inline editable textarea ─── */
function EditableTextArea({
    value,
    onChange,
    original,
    rows = 3,
    placeholder = '',
}: {
    value: string;
    onChange: (val: string) => void;
    original: string;
    rows?: number;
    placeholder?: string;
}) {
    const isChanged = value !== original;
    return (
        <div style={{ position: 'relative' }}>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={rows}
                placeholder={placeholder}
                style={{
                    width: '100%', resize: 'vertical',
                    padding: '10px 14px',
                    background: isChanged ? 'rgba(16,185,129,0.04)' : 'var(--bg-secondary)',
                    border: `1px solid ${isChanged ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: '0.88rem',
                    lineHeight: 1.6,
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s',
                }}
            />
            {isChanged && (
                <PencilSimple size={12} style={{
                    position: 'absolute', top: 10, right: 10,
                    color: 'var(--accent-green)', opacity: 0.6,
                }} />
            )}
        </div>
    );
}

/* ─── Inline editable text input ─── */
function EditableInput({
    value,
    onChange,
    original,
    style: extraStyle = {},
}: {
    value: string;
    onChange: (val: string) => void;
    original: string;
    style?: React.CSSProperties;
}) {
    const isChanged = value !== original;
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                width: '100%',
                padding: '6px 10px',
                background: isChanged ? 'rgba(16,185,129,0.04)' : 'transparent',
                border: `1px solid ${isChanged ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s',
                ...extraStyle,
            }}
        />
    );
}

/* ─── Skills Tag Editor ─── */
function SkillsEditor({
    skills,
    originalSkills,
    onChange,
}: {
    skills: string[];
    originalSkills: string[];
    onChange: (skills: string[]) => void;
}) {
    const [newSkill, setNewSkill] = useState('');
    const originalSet = new Set(originalSkills.map(s => s.toLowerCase()));

    const addSkill = () => {
        const trimmed = newSkill.trim();
        if (trimmed && !skills.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
            onChange([...skills, trimmed]);
            setNewSkill('');
        }
    };

    const removeSkill = (idx: number) => {
        onChange(skills.filter((_, i) => i !== idx));
    };

    return (
        <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {skills.map((skill, i) => {
                    const isOriginal = originalSet.has(skill.toLowerCase());
                    const wasReordered = isOriginal && originalSkills[i] !== skill;

                    return (
                        <span key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 6, fontSize: '0.8rem',
                            background: !isOriginal
                                ? 'rgba(16,185,129,0.12)' // new skill
                                : wasReordered
                                    ? 'rgba(59,130,246,0.08)' // reordered
                                    : 'var(--bg-secondary)',
                            border: `1px solid ${!isOriginal ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`,
                            color: !isOriginal ? 'var(--accent-green)' : 'var(--text-secondary)',
                        }}>
                            {skill}
                            <button
                                onClick={() => removeSkill(i)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    padding: 0, display: 'flex', color: 'var(--text-muted)',
                                }}
                            >
                                <X size={10} />
                            </button>
                        </span>
                    );
                })}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
                <input
                    type="text"
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                    placeholder="Thêm kỹ năng..."
                    style={{
                        flex: 1, padding: '6px 10px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-primary)',
                        fontSize: '0.82rem',
                        fontFamily: 'inherit',
                    }}
                />
                <button
                    onClick={addSkill}
                    disabled={!newSkill.trim()}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent-blue)', color: 'white',
                        border: 'none', cursor: 'pointer', fontSize: '0.78rem',
                        opacity: newSkill.trim() ? 1 : 0.4,
                    }}
                >
                    <Plus size={12} /> Thêm
                </button>
            </div>
        </div>
    );
}

/* ─── Experience Item Editor ─── */
function ExperienceEditor({
    items,
    originalItems,
    onChange,
}: {
    items: ExperienceDetail[];
    originalItems: ExperienceDetail[];
    onChange: (items: ExperienceDetail[]) => void;
}) {
    const updateItem = (idx: number, field: keyof ExperienceDetail, value: string | number) => {
        const updated = [...items];
        updated[idx] = { ...updated[idx], [field]: value };
        onChange(updated);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map((exp, i) => {
                const orig = originalItems[i];
                const titleChanged = orig && exp.title !== orig.title;
                const companyChanged = orig && exp.company !== orig.company;
                const descChanged = orig && exp.description !== orig.description;

                return (
                    <div key={i} style={{
                        padding: 16, borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        background: (titleChanged || companyChanged || descChanged)
                            ? 'rgba(16,185,129,0.02)' : 'transparent',
                    }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                            <EditableInput
                                value={exp.title}
                                onChange={(v) => updateItem(i, 'title', v)}
                                original={orig?.title || ''}
                                style={{ fontWeight: 600 }}
                            />
                            <EditableInput
                                value={exp.company}
                                onChange={(v) => updateItem(i, 'company', v)}
                                original={orig?.company || ''}
                            />
                            <span style={{
                                padding: '6px 10px', fontSize: '0.78rem',
                                color: 'var(--text-muted)', whiteSpace: 'nowrap',
                            }}>
                                {exp.duration_months} tháng
                            </span>
                        </div>
                        <EditableTextArea
                            value={exp.description}
                            onChange={(v) => updateItem(i, 'description', v)}
                            original={orig?.description || ''}
                            rows={4}
                            placeholder="Mô tả trách nhiệm và thành tích..."
                        />
                    </div>
                );
            })}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN: EditableCvPreview
   ═══════════════════════════════════════════════════════════════════════════════ */

interface EditableCvPreviewProps {
    originalCv: CVData;
    optimizedCv: CVData;
    onSave: (editedCv: CVData) => void;
}

export default function EditableCvPreview({ originalCv, optimizedCv, onSave }: EditableCvPreviewProps) {
    const [edited, setEdited] = useState<CVData>(() => JSON.parse(JSON.stringify(optimizedCv)));

    const update = useCallback((field: keyof CVData, value: CVData[keyof CVData]) => {
        setEdited(prev => ({ ...prev, [field]: value }));
    }, []);

    // Check what sections changed vs original
    const summaryChanged = edited.summary !== originalCv.summary;
    const skillsChanged = JSON.stringify(edited.skills) !== JSON.stringify(originalCv.skills);
    const expChanged = JSON.stringify(edited.experience) !== JSON.stringify(originalCv.experience);
    const eduChanged = JSON.stringify(edited.education) !== JSON.stringify(originalCv.education);
    const projChanged = JSON.stringify(edited.projects) !== JSON.stringify(originalCv.projects);

    const totalChanges = [summaryChanged, skillsChanged, expChanged, eduChanged, projChanged].filter(Boolean).length;

    return (
        <div>
            {/* Header legend */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 16, padding: '10px 16px',
                background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)' }} />
                        Đã chỉnh sửa bởi AI
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} />
                        Giữ nguyên
                    </span>
                    <span>Đã chỉnh sửa {totalChanges} mục</span>
                </div>
                <button
                    onClick={() => onSave(edited)}
                    className="btn-primary"
                    style={{
                        padding: '6px 18px', fontSize: '0.82rem',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}
                >
                    <CheckCircle size={14} weight="fill" /> Lưu & Tải xuống
                </button>
            </div>

            {/* Name */}
            <div style={{ marginBottom: 12 }}>
                <EditableInput
                    value={edited.name}
                    onChange={(v) => update('name', v)}
                    original={originalCv.name}
                    style={{ fontSize: '1.2rem', fontWeight: 700, padding: '8px 12px' }}
                />
            </div>

            {/* Sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Summary */}
                <Section
                    title="Tóm tắt nghề nghiệp"
                    icon={User}
                    isChanged={summaryChanged}
                    onRevert={() => update('summary', originalCv.summary)}
                >
                    <EditableTextArea
                        value={edited.summary}
                        onChange={(v) => update('summary', v)}
                        original={originalCv.summary}
                        rows={3}
                    />
                    {summaryChanged && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.04)', borderRadius: 6, fontSize: '0.78rem' }}>
                            <p style={{ color: 'var(--text-muted)', marginBottom: 4, fontSize: '0.7rem', textTransform: 'uppercase' }}>Bản gốc:</p>
                            <p style={{ color: 'var(--text-muted)', lineHeight: 1.5, textDecoration: 'line-through', opacity: 0.6 }}>
                                {originalCv.summary}
                            </p>
                        </div>
                    )}
                </Section>

                {/* Skills */}
                <Section
                    title="Kỹ năng"
                    icon={Lightbulb}
                    isChanged={skillsChanged}
                    onRevert={() => update('skills', [...originalCv.skills])}
                >
                    <SkillsEditor
                        skills={edited.skills}
                        originalSkills={originalCv.skills}
                        onChange={(s) => update('skills', s)}
                    />
                </Section>

                {/* Experience */}
                <Section
                    title="Kinh nghiệm làm việc"
                    icon={Briefcase}
                    isChanged={expChanged}
                    onRevert={() => update('experience', JSON.parse(JSON.stringify(originalCv.experience)))}
                >
                    <ExperienceEditor
                        items={edited.experience}
                        originalItems={originalCv.experience}
                        onChange={(items) => update('experience', items)}
                    />
                </Section>

                {/* Education */}
                <Section
                    title="Học vấn"
                    icon={GraduationCap}
                    isChanged={eduChanged}
                    onRevert={() => update('education', JSON.parse(JSON.stringify(originalCv.education)))}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {(edited.education || []).map((edu, i) => {
                            const orig = originalCv.education?.[i];
                            return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 8 }}>
                                    <EditableInput
                                        value={edu.degree}
                                        onChange={(v) => {
                                            const updated = [...edited.education];
                                            updated[i] = { ...updated[i], degree: v };
                                            update('education', updated);
                                        }}
                                        original={orig?.degree || ''}
                                        style={{ fontWeight: 600 }}
                                    />
                                    <EditableInput
                                        value={edu.institution}
                                        onChange={(v) => {
                                            const updated = [...edited.education];
                                            updated[i] = { ...updated[i], institution: v };
                                            update('education', updated);
                                        }}
                                        original={orig?.institution || ''}
                                    />
                                    <EditableInput
                                        value={edu.year}
                                        onChange={(v) => {
                                            const updated = [...edited.education];
                                            updated[i] = { ...updated[i], year: v };
                                            update('education', updated);
                                        }}
                                        original={orig?.year || ''}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </Section>

                {/* Projects */}
                {(edited.projects || []).length > 0 && (
                    <Section
                        title="Dự án"
                        icon={ListBullets}
                        isChanged={projChanged}
                        onRevert={() => update('projects', JSON.parse(JSON.stringify(originalCv.projects)))}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {edited.projects.map((proj, i) => {
                                const orig = originalCv.projects?.[i];
                                return (
                                    <div key={i} style={{
                                        padding: 12, borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border-subtle)',
                                    }}>
                                        <EditableInput
                                            value={proj.name}
                                            onChange={(v) => {
                                                const updated = [...edited.projects];
                                                updated[i] = { ...updated[i], name: v };
                                                update('projects', updated);
                                            }}
                                            original={orig?.name || ''}
                                            style={{ fontWeight: 600, marginBottom: 6 }}
                                        />
                                        <EditableTextArea
                                            value={proj.description}
                                            onChange={(v) => {
                                                const updated = [...edited.projects];
                                                updated[i] = { ...updated[i], description: v };
                                                update('projects', updated);
                                            }}
                                            original={orig?.description || ''}
                                            rows={2}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </Section>
                )}
            </div>
        </div>
    );
}
