// Browser Supabase client (auth only). Lazily created from the public env.
// If the env is missing the client is null and the app keeps working
// anonymously (db.ts falls back to its dev X-User-Id seam).
//
// SECURITY: only the *publishable* (anon) key belongs here — it is bundled
// into the browser. Never put a service/secret key in a NEXT_PUBLIC_ var.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _resolved = false;

export function getSupabase(): SupabaseClient | null {
    if (!_resolved) {
        _resolved = true;
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
            _client = createClient(url, key, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                },
            });
        }
    }
    return _client;
}

export function isAuthEnabled(): boolean {
    return getSupabase() !== null;
}
