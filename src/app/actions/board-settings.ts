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

/** Personnes prévenues des commentaires haineux en plus des admins et de l'auteur de la publication. */
export async function getModerationRecipients(): Promise<{ ids: string[]; members: { id: string; name: string; email: string | null }[] }> {
  const supabase = await createClient();
  const [{ data: settings }, { data: members }] = await Promise.all([
    supabase.from("board_settings").select("moderation_recipient_ids").eq("id", true).single(),
    supabase.from("profiles").select("id, first_name, last_name, email").order("last_name"),
  ]);
  return {
    ids: settings?.moderation_recipient_ids ?? [],
    members: (members ?? []).map((m) => ({
      id: m.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || "—",
      email: m.email,
    })),
  };
}

export async function setModerationRecipients(ids: string[]) {
  const { supabase, userId } = await requireAdmin();
  const { error } = await supabase
    .from("board_settings")
    .update({ moderation_recipient_ids: ids, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
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
