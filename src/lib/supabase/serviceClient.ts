import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Client à rôle de service — contourne la RLS. Réservé aux flux publics sans
 * session (ex. page de réponse d'inscription par lien/QR code) où le contrôle
 * d'accès se fait par la possession d'un jeton non devinable, jamais par
 * l'auth Supabase. Ne jamais exposer côté client.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
