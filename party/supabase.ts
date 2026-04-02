import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createPartySupabase(env: {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
