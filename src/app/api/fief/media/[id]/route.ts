import { createServiceClient } from "@/lib/supabase/serviceClient";
import { fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";

// Photo du fil FIEF, servie aux seules membres actives et à l'équipe FIEF (jamais de lien public vers le Drive).
// Publication masquée : visible de son autrice et de l'équipe seulement.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Photo inconnue.");
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");

  const service = createServiceClient();
  const { data: media } = await service.from("fief_media").select("storage_id, mime_type, uploader_id, post_id").eq("id", id).maybeSingle();
  if (!media) return fail(404, "Photo introuvable.");
  if (!media.post_id) {
    if (media.uploader_id !== actor.userId) return fail(404, "Photo introuvable.");
  } else if (!actor.manager) {
    const { data: post } = await service.from("fief_posts").select("hidden_at, author_id").eq("id", media.post_id).maybeSingle();
    if (!post || (post.hidden_at && post.author_id !== actor.userId)) return fail(404, "Photo introuvable.");
  }

  const storage = await getFiefStorage();
  if (!storage) return fail(503, "Stockage indisponible.");
  const upstream = await storage.fetch(media.storage_id);
  if (!upstream.ok || !upstream.body) return fail(502, "Photo indisponible.");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": media.mime_type,
      // Navigateur seulement (contenu réservé aux membres) ; une photo publiée ne change jamais.
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}
