import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PLACEHOLDER_MARKERS = [
  'your-project-id',
  'your_service_role_key',
  'your_secret_key',
  'sb_publishable_...',
  'sb_secret_your',
  'change_me_to',
  'your_'
];

function cleanEnvValue(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/^["']|["']$/g, '').trim();
}

function looksLikePlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function deriveSupabaseUrlFromDatabaseUrl(): string {
  const raw = cleanEnvValue(process.env.DATABASE_URL);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!parsed.hostname.toLowerCase().includes('supabase.com')) return '';
    const username = parsed.username;
    if (!username.toLowerCase().startsWith('postgres.')) return '';
    const ref = username.slice('postgres.'.length);
    if (!/^[a-z0-9]+$/.test(ref)) return '';
    const url = `https://${ref}.supabase.co`;
    new URL(url);
    return url;
  } catch {
    return '';
  }
}

// The database pool and the Auth API belong to the same Supabase project, so the Auth URL is
// derived from DATABASE_URL when available. This guarantees the backend validates tokens against
// the same project that issues the frontend access tokens even if a stray SUPABASE_URL /
// VITE_SUPABASE_URL placeholder or wrong-project URL is set on the deployment.
function resolveSupabaseUrl(): string {
  const derived = deriveSupabaseUrlFromDatabaseUrl();
  if (derived) return derived;
  const explicit = cleanEnvValue(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  if (explicit && !looksLikePlaceholder(explicit)) return explicit;
  return explicit;
}

function resolveServiceRoleKey(): string {
  return cleanEnvValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
  );
}

function resolveAnonKey(): string {
  return cleanEnvValue(
    process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  );
}

export const isSupabaseServiceConfigured = (): boolean =>
  Boolean(resolveSupabaseUrl() && resolveServiceRoleKey());

export const isSupabaseAnonConfigured = (): boolean =>
  Boolean(resolveSupabaseUrl() && resolveAnonKey());

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

export const getSupabaseServiceClient = (): SupabaseClient => {
  if (!isSupabaseServiceConfigured()) {
    throw new Error(
      'Supabase service role is not configured. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) ' +
      'and SUPABASE_URL (or VITE_SUPABASE_URL) in your server environment. Never expose this key as VITE_*.'
    );
  }
  if (!serviceClient) {
    serviceClient = createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return serviceClient;
};

// Public anon/publishable key client. Used ONLY as a token-validation fallback for auth.getUser();
// the anon key is public by design and performs the exact same Supabase JWT verification the
// browser client already uses, so this never accepts an unverified token.
export const getSupabaseAnonClient = (): SupabaseClient | null => {
  if (!isSupabaseAnonConfigured()) return null;
  if (!anonClient) {
    anonClient = createClient(resolveSupabaseUrl(), resolveAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return anonClient;
};

export const getSupabaseUrlHostname = (): string => {
  try {
    return new URL(resolveSupabaseUrl()).hostname;
  } catch {
    return '(unresolved)';
  }
};

export const resetSupabaseServiceClientForTesting = (): void => {
  serviceClient = null;
  anonClient = null;
};
