import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";

// Photo de profil d'une membre FIEF (recadrée au carré dans le navigateur, ≤ 2 Mo) → Drive du board
// (FIEF / Profils) ; fief_members.avatar_path garde l'identifiant du fichier. DELETE : retirer la photo.

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor?.member) return fail(403, "Réservé aux membres FIEF.");
  const member = actor.member;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !TYPES.has(file.type)) return fail(415, "Photo JPEG, PNG ou WebP attendue.");
  if (file.size > 2 * 1024 * 1024) return fail(413, "Photo trop lourde (2 Mo maximum).");

  const storage = await getFiefStorage();
  if (!storage) return fail(503, "Le stockage FIEF n'est pas configuré (Drive du board).");
  const service = createServiceClient();
  const { data: current } = await service.from("fief_members").select("avatar_path").eq("user_id", actor.userId).maybeSingle();
  try {
    const id = await storage.put(["Profils"], {
      name: `${member.lastName} ${member.firstName} ${randomUUID().slice(0, 6)}.jpg`,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
    const { error } = await service.from("fief_members").update({ avatar_path: id }).eq("user_id", actor.userId);
    if (error) {
      await storage.remove(id).catch(() => {});
      return fail(500, "Photo non enregistrée.");
    }
    if (current?.avatar_path) await storage.remove(current.avatar_path).catch(() => {});
    return done();
  } catch (e) {
    console.error("[fief.avatar]", e);
    return fail(502, "Envoi de la photo impossible pour le moment.");
  }
}

export async function DELETE() {
  const actor = await getFiefActor();
  if (!actor?.member) return fail(403, "Réservé aux membres FIEF.");
  const service = createServiceClient();
  const { data: current } = await service.from("fief_members").select("avatar_path").eq("user_id", actor.userId).maybeSingle();
  await service.from("fief_members").update({ avatar_path: null }).eq("user_id", actor.userId);
  const storage = await getFiefStorage();
  if (current?.avatar_path && storage) await storage.remove(current.avatar_path).catch(() => {});
  return done();
}
