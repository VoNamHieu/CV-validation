// Shared auth headers for browser → Next API calls. Prefers the Supabase
// session JWT (Authorization: Bearer …); falls back to the dev X-User-Id seam
// when Supabase Auth isn't configured. Used by both the DB client (db.ts) and
// the credit-metered AI calls (api.ts).
import { getSupabase } from './supabase';

let _devUserId: string | null = null;

export function setDevUserId(id: string | null) {
    _devUserId = id;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const sb = getSupabase();
    if (sb) {
        const { data } = await sb.auth.getSession();
        const token = data.session?.access_token;
        if (token) return { Authorization: `Bearer ${token}` };
    }
    return _devUserId ? { 'X-User-Id': _devUserId } : {};
}

export function hasAuth(): boolean {
    return getSupabase() !== null || _devUserId !== null;
}

// Current Supabase access token (JWT), or null. Used to hand the extension a
// token so its auto-apply / tailor calls can be credit-metered against the user.
export async function getAccessToken(): Promise<string | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
}
