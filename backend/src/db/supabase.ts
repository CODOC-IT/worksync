import { createClient, SupabaseClient } from '@supabase/supabase-js';

function resolveSupabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '') as string;
}

function resolveServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || '') as string;
}

export const isSupabaseServiceConfigured = (): boolean =>
  Boolean(resolveSupabaseUrl() && resolveServiceRoleKey());

let serviceClient: SupabaseClient | null = null;

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

export const resetSupabaseServiceClientForTesting = (): void => {
  serviceClient = null;
};
