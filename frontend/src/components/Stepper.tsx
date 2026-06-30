'use client';

import { Check, Upload, Globe, ListChecks, PencilSimple } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';

// Visual wizard phases. "Kết quả" lives inside step 2 (the search component
// switches to its results view), so the active phase is derived from both
// currentStep and wizardStage rather than the step number alone.
const steps = [
    { phase: 1, label: 'Tải CV', icon: Upload },
    { phase: 2, label: 'Tìm việc', icon: Globe },
    { phase: 3, label: 'Kết quả', icon: ListChecks },
    { phase: 4, label: 'Sửa CV', icon: PencilSimple },
];

interface StepperProps {
    currentStep: number;
}

export default function Stepper({ currentStep }: StepperProps) {
    const wizardStage = useAppStore((s) => s.wizardStage);

    const activePhase =
        currentStep === 1 ? 1
            : currentStep === 2 ? (wizardStage === 'results' ? 3 : 2)
                : 4;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 20px', maxWidth: 560, margin: '0 auto',
            position: 'relative', zIndex: 1,
        }}>
            {steps.map((step, i) => {
                const isCompleted = activePhase > step.phase;
                const isActive = activePhase === step.phase;
                const Icon = step.icon;

                return (
                    <div key={step.phase} style={{ display: 'contents' }}>
                        <div style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        }}>
                            <div
                                className={`stepper-dot ${isCompleted ? 'completed' : isActive ? 'active' : ''}`}
                            >
                                {isCompleted
                                    ? <Check size={16} weight="bold" />
                                    : <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
                                }
                            </div>
                            <span style={{
                                fontSize: '0.72rem',
                                fontWeight: isActive ? 600 : 400,
                                color: isCompleted ? 'var(--accent-green)' : isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                                whiteSpace: 'nowrap',
                                letterSpacing: '-0.01em',
                                transition: 'all 0.3s ease',
                            }}>
                                {step.label}
                            </span>
                        </div>
                        {i < steps.length - 1 && (
                            <div className={`stepper-line ${isCompleted ? 'completed' : ''}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
