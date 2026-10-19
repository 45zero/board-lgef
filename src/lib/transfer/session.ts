import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Compte du board connecté (cookie de session), ou null — un membre n'a pas besoin du code e-mail.
 * getClaims vérifie le jeton sur place (pas d'aller-retour vers le serveur d'authentification).
 */
export async function getTransferMember() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: p } = await supabase.from("profiles").select("first_name, last_name, email, role").eq("id", userId).single();
  const email = (p?.email || (typeof data.claims.email === "string" ? data.claims.email : "") || "").toLowerCase();
  if (!email) return null;
  return {
    id: userId,
    email,
    name: [p?.first_name, p?.last_name].filter(Boolean).join(" "),
    isAdmin: p?.role === "admin" || p?.role === "super_user",
  };
}
