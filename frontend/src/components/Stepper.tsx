'use client';

import { Check } from 'lucide-react';

const steps = [
    { num: 1, label: 'Upload CV' },
    { num: 2, label: 'Paste JD' },
    { num: 3, label: 'Match Score' },
    { num: 4, label: 'Optimize' },
    { num: 5, label: 'Download' },
];

interface StepperProps {
    currentStep: number;
}

export default function Stepper({ currentStep }: StepperProps) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 0', maxWidth: 650, margin: '0 auto' }}>
            {steps.map((step, i) => (
                <div key={step.num} style={{ display: 'contents' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <div
                            className={`stepper-dot ${currentStep > step.num ? 'completed' : currentStep === step.num ? 'active' : ''}`}
                        >
                            {currentStep > step.num ? <Check size={16} /> : step.num}
                        </div>
                        <span style={{
                            fontSize: '0.7rem',
                            fontWeight: currentStep === step.num ? 600 : 400,
                            color: currentStep >= step.num ? 'var(--text-primary)' : 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                        }}>
                            {step.label}
                        </span>
                    </div>
                    {i < steps.length - 1 && (
                        <div className={`stepper-line ${currentStep > step.num ? 'completed' : ''}`} />
                    )}
                </div>
            ))}
        </div>
    );
}
