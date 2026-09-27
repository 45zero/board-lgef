import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Habilité à publier : administrateur, ou personne désignée dans le centre de publication
 * (board_settings.publisher_ids). Seuls eux voient le centre et reçoivent « Média à publier ».
 */
export async function isPublisher(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const [{ data: profile }, { data: settings }] = await Promise.all([
    client.from("profiles").select("role").eq("id", userId).single(),
    client.from("board_settings").select("publisher_ids").eq("id", true).single(),
  ]);
  if (profile?.role === "admin" || profile?.role === "super_user") return true;
  return (settings?.publisher_ids ?? []).includes(userId);
}
