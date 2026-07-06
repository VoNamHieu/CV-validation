'use client';

// Admin roster + permission granting ("phân quyền"). Two tiers:
//   • SUPER admins — from the backend ADMIN_EMAILS env. Read-only here; highest
//     privilege; the only role allowed to remove members.
//   • MEMBER admins — granted through this panel. Full admin rights EXCEPT
//     removing members.
// Any admin can add a member. The remove button only renders for a SUPER admin
// (and the backend re-enforces it), so a member can never purge the roster.
import { useCallback, useEffect, useState } from 'react';
import {
    ShieldStar, UserPlus, Trash, ArrowsClockwise, WarningCircle, CheckCircle,
    Crown, UserCircle, SpinnerGap,
} from '@phosphor-icons/react';
import { admin, type AdminMember, type AdminRole } from '@/lib/db';

function ago(iso: string): string {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s trước`;
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

export default function MembersPanel({ role }: { role: AdminRole }) {
    const isSuper = role === 'super';

    const [supers, setSupers] = useState<string[]>([]);
    const [members, setMembers] = useState<AdminMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [email, setEmail] = useState('');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState('');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const r = await admin.listMembers();
            setSupers(r.super_admins);
            setMembers(r.members);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được danh sách');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const doAdd = useCallback(async () => {
        const e = email.trim().toLowerCase();
        setError(''); setSuccess('');
        if (!e || !e.includes('@')) { setError('Nhập email hợp lệ'); return; }
        setAdding(true);
        try {
            await admin.addMember(e);
            setSuccess(`Đã cấp quyền admin cho ${e}.`);
            setEmail('');
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Cấp quyền thất bại');
        } finally {
            setAdding(false);
        }
    }, [email, load]);

    const doRemove = useCallback(async (target: string) => {
        setError(''); setSuccess('');
        setRemoving(target);
        try {
            await admin.removeMember(target);
            setSuccess(`Đã gỡ quyền admin của ${target}.`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Gỡ quyền thất bại');
        } finally {
            setRemoving('');
        }
    }, [load]);

    const inputStyle: React.CSSProperties = {
        flex: 1, padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
    };

    return (
        <div style={{ maxWidth: 560 }}>
            {/* Add member — SUPER-admin only (backend also enforces). Members can
                see the roster but not grant/revoke. */}
            {isSuper && (
            <div className="glass-card" style={{ padding: 24, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <UserPlus size={18} weight="duotone" style={{ color: 'var(--accent-purple, #8b5cf6)' }} />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Cấp quyền admin</h3>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
                    Người được cấp có toàn quyền admin, <strong>trừ</strong> quyền gỡ thành viên. Chỉ super admin (cấu hình ở backend) mới gỡ được thành viên.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input type="email" placeholder="user@example.com" value={email} autoComplete="off"
                        onChange={(e) => { setEmail(e.target.value); setSuccess(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); }}
                        style={inputStyle} />
                    <button className="btn-primary" onClick={doAdd} disabled={adding || !email.trim()}
                        style={{ padding: '0 18px', display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                        {adding
                            ? <SpinnerGap size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                            : <UserPlus size={16} weight="bold" />}
                        Thêm
                    </button>
                </div>
            </div>
            )}

            {/* Alerts — outside the add card so roster/remove errors show for
                members too (who don't see the super-only add form). */}
            {error && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.8rem', color: 'var(--accent-red, #ef4444)' }}>
                    <WarningCircle size={16} weight="fill" /> {error}
                </div>
            )}
            {success && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.8rem', color: 'var(--accent-green, #22c55e)' }}>
                    <CheckCircle size={16} weight="fill" /> {success}
                </div>
            )}

            {/* Roster */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    <ShieldStar size={16} weight="duotone" /> Danh sách quản trị viên
                </span>
                <button className="btn-secondary" onClick={load} disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '6px 12px' }}>
                    <ArrowsClockwise size={13} weight="bold" /> Tải lại
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* SUPER admins — env-configured, read-only */}
                {supers.map((e) => (
                    <div key={`s-${e}`} className="glass-card" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, padding: '12px 14px',
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <Crown size={18} weight="fill" style={{ color: 'var(--accent-amber, #f59e0b)', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e}</span>
                        </span>
                        <span style={{
                            fontSize: '0.66rem', fontWeight: 700, padding: '2px 9px', borderRadius: 10,
                            background: 'var(--bg-elevated)', color: 'var(--accent-amber, #f59e0b)', flexShrink: 0,
                        }}>SUPER ADMIN</span>
                    </div>
                ))}

                {/* MEMBER admins — UI-granted */}
                {members.map((m) => (
                    <div key={`m-${m.email}`} className="glass-card" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, padding: '12px 14px',
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <UserCircle size={18} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <span style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                    {m.added_by ? `bởi ${m.added_by} · ` : ''}{ago(m.created_at)}
                                </span>
                            </span>
                        </span>
                        {isSuper ? (
                            <button onClick={() => doRemove(m.email)} disabled={removing === m.email}
                                title="Gỡ quyền admin" style={{
                                    background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                                    color: 'var(--accent-red, #ef4444)', display: 'flex', alignItems: 'center', padding: 6,
                                    opacity: removing === m.email ? 0.5 : 1,
                                }}>
                                {removing === m.email
                                    ? <SpinnerGap size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                                    : <Trash size={16} weight="bold" />}
                            </button>
                        ) : (
                            <span style={{
                                fontSize: '0.66rem', fontWeight: 700, padding: '2px 9px', borderRadius: 10,
                                background: 'var(--bg-elevated)', color: 'var(--text-secondary)', flexShrink: 0,
                            }}>ADMIN</span>
                        )}
                    </div>
                ))}

                {!loading && supers.length === 0 && members.length === 0 && (
                    <div style={{
                        padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)',
                        border: '1px dashed var(--border-subtle)', borderRadius: 12, fontSize: '0.85rem',
                    }}>
                        Chưa có quản trị viên nào.
                    </div>
                )}
            </div>

            {!isSuper && members.length > 0 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
                    Bạn là admin thường — chỉ super admin mới gỡ được thành viên.
                </p>
            )}
        </div>
    );
}
