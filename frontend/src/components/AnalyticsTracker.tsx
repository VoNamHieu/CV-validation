'use client';

// Centralised funnel tracking. Instead of scattering track() calls across the
// wizard, this single mounted observer derives funnel events from store state
// transitions + the extension's apply-progress messages. Each step fires once
// per session. Renders nothing.
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import { track } from '@/lib/analytics';

export default function AnalyticsTracker() {
    const { enabled, user } = useAuth();
    const entered = useAppStore((s) => s.entered);
    const cvData = useAppStore((s) => s.cvData);
    const currentStep = useAppStore((s) => s.currentStep);
    const wizardStage = useAppStore((s) => s.wizardStage);
    const jdEntries = useAppStore((s) => s.jdEntries);

    const firedRef = useRef<Set<string>>(new Set());
    const prevProcessingRef = useRef(false);

    // Only count real users (logged in when auth is enabled), once per step.
    const active = !(enabled && !user);
    const once = useCallback((event: string, meta?: Record<string, unknown>) => {
        if (firedRef.current.has(event)) return;
        firedRef.current.add(event);
        track(event, meta);
    }, []);

    useEffect(() => { if (active && entered) once('entered'); }, [active, entered, once]);
    useEffect(() => { if (active && cvData) once('cv_uploaded'); }, [active, cvData, once]);
    useEffect(() => { if (active && entered && currentStep >= 2) once('search_viewed'); }, [active, entered, currentStep, once]);
    useEffect(() => { if (active && wizardStage === 'results') once('results_viewed'); }, [active, wizardStage, once]);
    useEffect(() => {
        if (active && jdEntries.some((e) => e.status === 'scoring' || e.optimizing || e.status === 'done')) {
            once('optimize_started');
        }
    }, [active, jdEntries, once]);
    useEffect(() => { if (active && currentStep >= 3) once('editor_reached'); }, [active, currentStep, once]);

    // Apply funnel from the extension's progress broadcasts.
    useEffect(() => {
        const onMsg = (e: MessageEvent) => {
            if (e.source !== window || e.data?.type !== 'JOBFIT_APPLY_PROGRESS') return;
            const processing = !!e.data.isProcessing;
            const total = e.data.total ?? 0;
            if (active && processing && total > 0) once('apply_started', { total });
            if (active && prevProcessingRef.current && !processing && total > 0) {
                once('apply_done', { total, submitted: e.data.submitted ?? 0 });
            }
            prevProcessingRef.current = processing;
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, [active, once]);

    return null;
}
