import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  // Surfaced clearly rather than crashing the build — createClient() throws
  // immediately if the URL is missing/empty, and this file's top-level code
  // runs during Next.js's page-generation step, not just in the browser.
  console.warn(
    'Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your Vercel project settings, then redeploy.'
  );
}

// Fall back to a harmless placeholder URL so createClient() never throws at
// import time. Real requests will simply fail (and the app shows a clear
// "not configured" screen) instead of taking down the whole build.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key'
);

