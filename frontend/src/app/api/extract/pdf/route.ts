import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ detail: "No file provided" }, { status: 400 });
        }

        if (!file.name.toLowerCase().endsWith(".pdf")) {
            return NextResponse.json({ detail: "Only PDF files are supported." }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Dynamic import to avoid build-time canvas issues
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfParseModule = await import("pdf-parse") as any;
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const data = await pdfParse(buffer);

        return NextResponse.json({
            filename: file.name,
            extracted_text: data.text,
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to parse PDF";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
