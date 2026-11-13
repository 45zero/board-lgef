import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { fail, getFiefActor } from "@/lib/fief/actor";
import { getFiefStorage } from "@/lib/fief/storage";

// Publicité FIEF : image (membres et équipe), ou ?go=1 — compte le clic puis redirige vers le lien de l'annonceur.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Publicité inconnue.");
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");
  const service = createServiceClient();
  const { data: ad } = await service.from("fief_ads").select("link_url, clicks, image_storage_id, image_mime").eq("id", id).maybeSingle();
  if (!ad) return fail(404, "Publicité introuvable.");

  if (new URL(request.url).searchParams.get("go") === "1") {
    if (!ad.link_url) return fail(404, "Pas de lien.");
    if (!actor.manager) await service.from("fief_ads").update({ clicks: ad.clicks + 1 }).eq("id", id);
    return NextResponse.redirect(ad.link_url, 302);
  }

  if (!ad.image_storage_id) return fail(404, "Pas d'image.");
  const storage = await getFiefStorage();
  const upstream = storage ? await storage.fetch(ad.image_storage_id).catch(() => null) : null;
  if (!upstream?.ok || !upstream.body) return fail(502, "Image indisponible.");
  return new Response(upstream.body, { headers: { "Content-Type": ad.image_mime ?? "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
