'use client';

// Contains a render throw to a subtree instead of letting it blank the whole
// app (there was no boundary — one malformed job entry could crash the entire
// editor, "chết cả loạt"). Reset by changing `resetKey` (e.g. the entry id): a
// new entry re-mounts the boundary so a previous entry's error doesn't stick.
import { Component, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    resetKey?: string | number;
    /** Inline fallback UI. Defaults to a compact error card. */
    fallback?: ReactNode;
    /** Optional label for the default fallback ("phần này"). */
    label?: string;
}
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidUpdate(prev: Props) {
        // Clear the error when the caller swaps resetKey (e.g. user picks another job).
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    componentDidCatch(error: Error) {
        // eslint-disable-next-line no-console
        console.error('[ErrorBoundary] contained render error:', error);
    }

    render() {
        if (this.state.error) {
            if (this.props.fallback !== undefined) return this.props.fallback;
            return (
                <div style={{
                    padding: '14px 16px', borderRadius: 10,
                    border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                    fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5,
                }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                        Không hiển thị được {this.props.label || 'phần này'}
                    </div>
                    Dữ liệu của mục này có vấn đề. Các mục khác vẫn dùng bình thường, thử chọn job khác hoặc tối ưu lại.
                </div>
            );
        }
        return this.props.children;
    }
}
