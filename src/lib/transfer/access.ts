import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";

/**
 * Accès d'un membre à un transfert : « manage » (expéditeur ou admin), « recipient » (adresse parmi
 * les destinataires, ou transfert qu'on lui a fait suivre), sinon erreur. Hors des fichiers
 * "use server" : le membre doit venir de la session, jamais du navigateur.
 */
export async function transferAccessFor(member: { id: string; email: string; isAdmin: boolean }, id: string) {
  const s = createServiceClient();
  const { data: t } = await s
    .from("transfers")
    .select("id, code, status, title, message, sender_email, sender_name, sender_user_id, recipients, expires_at, drive_folder_id, file_count, total_bytes")
    .eq("id", id)
    .maybeSingle();
  if (!t) throw new Error("Transfert introuvable.");
  if (t.sender_user_id === member.id || member.isAdmin) return { t, access: "manage" as const };
  if (t.recipients.includes(member.email)) return { t, access: "recipient" as const };
  const { count } = await s.from("transfer_forwards").select("id", { count: "exact", head: true }).eq("transfer_id", id).contains("recipients", [member.email]);
  if (count) return { t, access: "recipient" as const };
  throw new Error("Transfert introuvable.");
}
