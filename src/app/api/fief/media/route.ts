import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { done, fail, getFiefActor } from "@/lib/fief/actor";
import { feedFolder, getFiefStorage } from "@/lib/fief/storage";

// Envoi d'une photo du fil FIEF (réduite dans le navigateur, ≤ 4 Mo) → Drive du board (FIEF / Fil d'actu /
// AAAA-MM). Le fichier est rattaché à la publication au moment de la publier (/api/fief/feed).

export const maxDuration = 60;

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Aucune photo reçue.");
  const ext = TYPES[file.type];
  if (!ext) return fail(415, "Format non pris en charge (JPEG, PNG, WebP ou GIF).");
  if (file.size > MAX_BYTES) return fail(413, "Photo trop lourde (4 Mo maximum).");

  // Garde-fou : pas plus de 30 photos en attente de publication par personne.
  const service = createServiceClient();
  const { count } = await service.from("fief_media").select("id", { count: "exact", head: true }).eq("uploader_id", actor.userId).is("post_id", null);
  if ((count ?? 0) >= 30) return fail(429, "Trop de photos en attente : publiez ou rechargez la page.");

  const storage = await getFiefStorage();
  if (!storage) return fail(503, "Le stockage FIEF n'est pas configuré (Drive du board).");

  const width = Number(form?.get("width")) || null;
  const height = Number(form?.get("height")) || null;
  try {
    const storageId = await storage.put(feedFolder(), {
      name: `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    });
    const { data, error } = await service
      .from("fief_media")
      .insert({ uploader_id: actor.userId, storage_id: storageId, mime_type: file.type, size_bytes: file.size, width, height })
      .select("id")
      .single();
    if (error) {
      await storage.remove(storageId).catch(() => {});
      return fail(500, "Photo non enregistrée.");
    }
    return done({ id: data.id });
  } catch (e) {
    console.error("[fief.media]", e);
    return fail(502, "Envoi de la photo impossible pour le moment.");
  }
}
