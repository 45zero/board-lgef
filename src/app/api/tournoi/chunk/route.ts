import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Tournois : relaie un morceau (≤ 4 Mo) d'une pièce (affiche, règlement, pièce jointe d'une réponse)
// vers la session d'envoi du Drive — le navigateur ne peut pas viser Google directement (CORS).
// Accès : l'identifiant de la pièce, rendu au dépôt, valable 6 h tant que l'envoi n'est pas terminé.
// Corps vide + `Content-Range: bytes */<taille>` : où en est l'envoi (reprise après coupure).

export const maxDuration = 60;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function PUT(request: Request) {
  const fileId = request.headers.get("x-file-id") ?? "";
  const contentRange = request.headers.get("content-range");
  if (!/^[0-9a-f-]{36}$/i.test(fileId) || !contentRange) return fail(400, "Requête invalide.");

  const service = createServiceClient();
  const { data: file } = await service.from("tournament_files").select("id, status, upload_url, mime_type, created_at").eq("id", fileId).maybeSingle();
  if (!file) return fail(404, "Envoi introuvable.");
  if (file.status !== "uploading" || !file.upload_url) return fail(409, "Cette pièce est déjà envoyée.");
  if (Date.now() - new Date(file.created_at).getTime() > 6 * 3600_000) return fail(410, "Envoi expiré : recommencez.");

  const buffer = Buffer.from(await request.arrayBuffer());
  const googleRes = await fetch(file.upload_url, {
    method: "PUT",
    headers: { "Content-Range": contentRange, "Content-Length": String(buffer.length), "Content-Type": file.mime_type || "application/octet-stream" },
    body: buffer.length ? buffer : undefined,
  });

  if (googleRes.status === 308) return new NextResponse(null, { status: 308, headers: { "x-range": googleRes.headers.get("range") ?? "" } });
  if (!googleRes.ok) {
    console.error("[tournoi.chunk]", googleRes.status, (await googleRes.text()).slice(0, 300));
    return fail(502, "Le serveur de fichiers a refusé ce morceau : réessayez.");
  }
  const { id: storageKey } = (await googleRes.json()) as { id: string };
  const { error } = await service.from("tournament_files").update({ status: "ready", storage_key: storageKey, upload_url: null }).eq("id", file.id);
  if (error) return fail(500, "Pièce envoyée mais non enregistrée.");
  return NextResponse.json({ ok: true, id: file.id });
}
