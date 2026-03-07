import { NextResponse } from 'next/server';

/**
 * GET /api/export-profile
 * 
 * Returns the current user profile data from localStorage (via client-side store).
 * The extension popup calls this to import optimized CV data.
 * 
 * Since Zustand persists to localStorage, this endpoint reads from the
 * persisted store data passed via query params or returns a template.
 */
export async function GET(request: Request) {
    // The actual profile data lives in the browser's localStorage (Zustand persist)
    // The extension will read it from the web app via postMessage instead.
    // This endpoint serves as a health check and provides the data schema.

    return NextResponse.json({
        status: 'ready',
        message: 'Use the "Export to Extension" button in the CV editor to send data to the extension.',
        schema: {
            firstName: 'string',
            lastName: 'string',
            fullName: 'string',
            email: 'string',
            phone: 'string',
            dateOfBirth: 'DD/MM/YYYY',
            gender: 'Nam | Nữ',
            nationality: 'Người Việt Nam | Người nước ngoài',
            maritalStatus: 'Độc thân | Đã kết hôn',
            address: { province: 'string', district: 'string', street: 'string' },
            currentTitle: 'string',
            currentLevel: 'string',
            yearsOfExperience: 'number',
            highestDegree: 'string',
            currentIndustry: 'string',
            currentFields: 'string[]',
            currentSalary: 'number',
            desiredLocations: 'string[]',
            desiredSalary: 'number',
            coverLetter: 'string',
        }
    });
}

/**
 * POST /api/export-profile
 * 
 * Receives profile data from the client-side and returns it formatted
 * for the extension to consume.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Transform CVData + user input into extension profile format
        const profile = {
            firstName: body.firstName || '',
            lastName: body.lastName || '',
            fullName: body.fullName || `${body.lastName || ''} ${body.firstName || ''}`.trim(),
            email: body.email || '',
            phone: body.phone || '',
            dateOfBirth: body.dateOfBirth || '',
            gender: body.gender || '',
            nationality: body.nationality || 'Người Việt Nam',
            maritalStatus: body.maritalStatus || '',
            address: body.address || { province: '', district: '', street: '' },
            currentTitle: body.currentTitle || body.cvData?.objective || '',
            currentLevel: body.currentLevel || '',
            yearsOfExperience: body.yearsOfExperience || 0,
            highestDegree: body.highestDegree || '',
            currentIndustry: body.currentIndustry || '',
            currentFields: body.currentFields || [],
            currentSalary: body.currentSalary || 0,
            desiredLocations: body.desiredLocations || [],
            desiredSalary: body.desiredSalary || 0,
            coverLetter: body.coverLetter || '',
        };

        return NextResponse.json({ success: true, profile });
    } catch (error) {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 }
        );
    }
}
