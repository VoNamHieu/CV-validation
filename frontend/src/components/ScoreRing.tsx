'use client';

interface ScoreRingProps {
    score: number;
    size?: number;
    strokeWidth?: number;
    label?: string;
}

export default function ScoreRing({ score, size = 160, strokeWidth = 10, label }: ScoreRingProps) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    const getColor = (s: number) => {
        if (s >= 80) return 'var(--accent-green)';
        if (s >= 60) return 'var(--accent-cyan)';
        if (s >= 40) return 'var(--accent-amber)';
        return 'var(--accent-red)';
    };

    return (
        <div className="score-ring" style={{ width: size, height: size }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="var(--bg-secondary)"
                    strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={getColor(score)}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    style={{ filter: `drop-shadow(0 0 8px ${getColor(score)})` }}
                />
            </svg>
            <div style={{
                position: 'absolute',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
            }}>
                <span style={{ fontSize: size * 0.28, fontWeight: 800, color: getColor(score) }}>{score}</span>
                {label && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{label}</span>}
            </div>
        </div>
    );
}
