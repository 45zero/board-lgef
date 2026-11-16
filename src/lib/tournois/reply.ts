import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { sha256 } from "@/lib/tournois/core";

// Lien « Répondre » d'un mail de dossier : jeton personnel d'un destinataire (sha256 en base).
// Ce qu'il ouvre : le message reçu, les pièces jointes à ce message (et, pour le club, ses propres
// pièces et le récapitulatif), le formulaire de réponse. Hors server actions : jamais appelable du navigateur.

export async function recipientByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const service = createServiceClient();
  const { data: rec } = await service
    .from("tournament_message_recipients")
    .select("id, message_id, email, name, role, opened_at")
    .eq("reply_token_hash", sha256(token))
    .maybeSingle();
  if (!rec) return null;
  const { data: message } = await service
    .from("tournament_messages")
    .select("id, declaration_id, subject, body, sent_by, include_pdf, created_at")
    .eq("id", rec.message_id)
    .maybeSingle();
  if (!message) return null;

  const [{ data: links }, { data: all }] = await Promise.all([
    service.from("tournament_message_files").select("file_id").eq("message_id", message.id),
    service.from("tournament_files").select("id, file_name, kind, size_bytes, source, storage_key, mime_type").eq("declaration_id", message.declaration_id).eq("status", "ready"),
  ]);
  const linked = new Set((links ?? []).map((l) => l.file_id));
  const own = rec.role === "contact" || rec.role === "club";
  const files = (all ?? []).filter((f) => linked.has(f.id) || (own && f.source === "form"));
  return { service, rec, message, files, pdf: message.include_pdf || own };
}
