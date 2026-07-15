import { NextResponse } from 'next/server';
import { APPLY_RECIPES } from '@/lib/applyRecipes';

/**
 * GET /api/apply-recipes
 *
 * Public feed of per-ATS apply recipes the extension's auto-apply agent uses to
 * fill account-gated forms (Workday…) deterministically. Recipes are code in the
 * repo (src/lib/applyRecipes.ts), so a broken selector ships with a Vercel deploy
 * — no Chrome Web Store review. No auth: recipes carry no user data; cached.
 */
export function GET() {
    return NextResponse.json(
        { version: 1, recipes: APPLY_RECIPES },
        { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } },
    );
}
