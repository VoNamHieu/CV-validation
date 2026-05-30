import { NextResponse } from 'next/server';
import { cvToExtensionProfile, type ExtensionProfile } from '@/lib/extension-profile';
import type { CVData } from '@/lib/types';

/**
 * GET /api/export-profile
 * Returns the canonical 23-field schema the extension popup expects.
 * The server is stateless and has no session — the actual profile data
 * flows from the web app to the extension via window.postMessage, not via
 * this endpoint. Kept as a schema reference + health check.
 */
export async function GET() {
    return NextResponse.json({
        status: 'ready',
        message: 'Profile data is pushed to the extension via postMessage from the CV editor. This endpoint exposes the canonical 23-field schema only.',
        schema: {
            fullName: 'string',
            firstName: 'string',
            lastName: 'string',
            email: 'string',
            phone: 'string',
            dateOfBirth: 'string (YYYY-MM-DD)',
            gender: 'string',
            nationality: 'string',
            maritalStatus: 'string',
            addressProvince: 'string',
            addressDistrict: 'string',
            addressStreet: 'string',
            currentTitle: 'string',
            currentLevel: 'string',
            yearsOfExperience: 'number',
            highestDegree: 'string',
            currentSalary: 'string',
            currentIndustry: 'string',
            currentFields: 'string',
            desiredLocations: 'string',
            desiredSalary: 'string',
            coverLetter: 'string',
            skills: 'string (comma-separated)',
        } satisfies Record<keyof ExtensionProfile, string>,
    });
}

/**
 * POST /api/export-profile
 * Body: { cvData: CVData } — server maps it into the 23-field ExtensionProfile.
 * Single source of truth for the mapping: cvToExtensionProfile.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const cvData = body?.cvData as CVData | undefined;
        if (!cvData || typeof cvData !== 'object') {
            return NextResponse.json(
                { error: 'cvData is required in the request body' },
                { status: 400 },
            );
        }
        const profile = cvToExtensionProfile(cvData);
        return NextResponse.json({ success: true, profile });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
