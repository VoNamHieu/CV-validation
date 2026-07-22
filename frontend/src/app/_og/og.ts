// Shared helpers for the OG image routes. `_og` is a private folder (underscore
// prefix) so it never becomes a route — just colocates the font + loader.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// satori (behind next/og ImageResponse) ships no Vietnamese glyphs, so we feed it
// Be Vietnam Pro. `new URL(..., import.meta.url)` keeps the .ttf traced/bundled.
let cached: Buffer | null = null;
export async function beVietnamFont(): Promise<Buffer> {
  if (!cached) {
    cached = await readFile(
      fileURLToPath(new URL('./BeVietnamPro-SemiBold.ttf', import.meta.url)),
    );
  }
  return cached;
}

// Brand palette (matches the landing).
export const OG = {
  bg: '#fbf7f4',
  ink: '#1b1720',
  brand: '#c43b2e',
  muted: '#6b6470',
};
