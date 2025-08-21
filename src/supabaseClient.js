import { createClient } from '@supabase/supabase-js';

// Environment variables (define in .env.local -> VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	// Surface a friendly error once for missing env configuration
	// eslint-disable-next-line no-console
	console.warn('Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		// Keep session only for the life of the browser tab/window
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
		// Store Supabase auth state in sessionStorage instead of localStorage
		// so it doesn't survive browser restarts and doesn't appear in Local Storage
		storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
	},
});

export default supabase;
