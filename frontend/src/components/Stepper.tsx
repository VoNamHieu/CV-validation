'use client';

import { Check, Upload, Globe, PencilSimple } from '@phosphor-icons/react';

const steps = [
    { num: 1, label: 'Upload CV', icon: Upload },
    { num: 2, label: 'Find Jobs', icon: Globe },
    { num: 3, label: 'Edit CV', icon: PencilSimple },
];

interface StepperProps {
    currentStep: number;
}

export default function Stepper({ currentStep }: StepperProps) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 20px', maxWidth: 480, margin: '0 auto',
            position: 'relative', zIndex: 1,
        }}>
            {steps.map((step, i) => {
                const isCompleted = currentStep > step.num;
                const isActive = currentStep === step.num;
                const Icon = step.icon;

                return (
                    <div key={step.num} style={{ display: 'contents' }}>
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
