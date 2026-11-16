import { createServiceClient } from "@/lib/supabase/serviceClient";
import { fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";
import { canSeeDocument } from "@/lib/fief/visibility";

// Téléchargement d'un document FIEF (jamais de lien public vers le Drive) : sa propriétaire, toute membre
// active du public si le document est partagé, l'équipe FIEF. ?inline=1 : affichage dans le navigateur (PDF, images).

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Document inconnu.");
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");

  const { data: doc } = await createServiceClient().from("fief_documents").select("name, mime_type, owner_id, visibility, status, storage_id, audience, audience_ids, audience_functions, audience_clubs").eq("id", id).maybeSingle();
  if (!doc || doc.status !== "ready" || !doc.storage_id) return fail(404, "Document introuvable.");
  if (!canSeeDocument(actor, doc)) return fail(404, "Document introuvable.");

  const storage = await getFiefStorage();
  if (!storage) return fail(503, "Stockage indisponible.");
  const upstream = await storage.fetch(doc.storage_id);
  if (!upstream.ok || !upstream.body) return fail(502, "Document indisponible.");

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const ascii = doc.name.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "document";
  const length = upstream.headers.get("content-length");
  return new Response(upstream.body, {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      ...(length ? { "Content-Length": length } : {}),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
