import { NextResponse } from 'next/server';
import { cvToExtensionProfile, type ExtensionProfile } from '@/lib/extension-profile';
import type { CVData } from '@/lib/types';

/**
 * GET /api/export-profile
 * Returns the canonical profile schema the extension popup expects.
 * The server is stateless and has no session — the actual profile data
 * flows from the web app to the extension via window.postMessage, not via
 * this endpoint. Kept as a schema reference + health check.
 */
export async function GET() {
    return NextResponse.json({
        status: 'ready',
        message: 'Profile data is pushed to the extension via postMessage from the CV editor. This endpoint exposes the canonical profile schema only.',
        schema: {
            fullName: 'string',
            firstName: 'string',
            lastName: 'string',
            email: 'string',
            phone: 'string',
            dateOfBirth: 'string (YYYY-MM-DD)',
            gender: 'string',
            nationality: 'string',
            ethnicity: 'string (ethnic group, e.g. Kinh)',
            maritalStatus: 'string',
            addressProvince: 'string',
            addressDistrict: 'string',
            addressStreet: 'string',
            currentTitle: 'string',
            currentLevel: 'string',
            yearsOfExperience: 'number',
            highestDegree: 'string',
            postalCode: 'string',
            noticePeriod: 'string',
            gpa: 'string (education GPA, e.g. 3.6/4.0)',
            workAuthorized: 'string',
            requiresSponsorship: 'string',
            currentSalary: 'string',
            currentIndustry: 'string',
            currentFields: 'string',
            desiredLocations: 'string',
            desiredSalary: 'string',
            coverLetter: 'string',
            applyMessage: 'string (short note for an ATS message-to-hiring-team box)',
            skills: 'string (comma-separated)',
            middleName: 'string (tên đệm — some tenants require it in both scripts)',
            addressStreet2: 'string (address line 2, usually empty)',
        } satisfies Record<keyof ExtensionProfile, string>,
    });
}

/**
 * POST /api/export-profile
 * Body: { cvData: CVData } — server maps it into the ExtensionProfile.
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
