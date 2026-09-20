"use server";

import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_user") {
    throw new Error("Réservé aux administrateurs.");
  }
  return { supabase, userId: user.id };
}

/** Compte Google connecté désigné comme "Drive du board" — reçoit tous les médias d'événements, quel que soit l'uploadeur. */
export async function getBoardDriveAccountId() {
  const supabase = await createClient();
  const { data } = await supabase.from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  return data?.drive_connected_account_id ?? null;
}

export async function setBoardDriveAccount(accountId: string | null) {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase
    .from("board_settings")
    .update({ drive_connected_account_id: accountId, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
}
