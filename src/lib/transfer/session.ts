import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Compte du board connecté (cookie de session), ou null — un membre n'a pas besoin du code e-mail. */
export async function getTransferMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("first_name, last_name, email, role").eq("id", user.id).single();
  const email = (p?.email || user.email || "").toLowerCase();
  if (!email) return null;
  return {
    id: user.id,
    email,
    name: [p?.first_name, p?.last_name].filter(Boolean).join(" "),
    isAdmin: p?.role === "admin" || p?.role === "super_user",
  };
}
