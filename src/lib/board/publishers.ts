import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Habilité à publier = voit le centre de publication (module « audiovisuel ») : administrateur,
 * ou personne désignée par la règle d'accès du module (sql/2026-09-29_module_access.sql). Ces
 * personnes reçoivent aussi « Média à publier ».
 */
export async function isPublisher(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("can_see_module", { uid: userId, p_module: "audiovisuel" });
  if (error) {
    console.error("[isPublisher]", error);
    return false;
  }
  return data === true;
}
