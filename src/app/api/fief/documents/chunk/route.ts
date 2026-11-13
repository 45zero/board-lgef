import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { fail, getFiefActor } from "@/lib/fief/actor";
import { notifyFief } from "@/lib/fief/notify";

// Documents FIEF : relaie un morceau (≤ 4 Mo) vers la session d'envoi du Drive (le navigateur ne peut pas
// viser Google directement — CORS), comme /api/transfer/chunk. L'adresse de session reste côté serveur
// (fief_documents.upload_url). Corps vide + `Content-Range: bytes */<taille>` : où en est l'envoi (reprise).
// Dernier morceau : document prêt ; un document de l'équipe est annoncé aux membres.

export const maxDuration = 60;

export async function PUT(request: Request) {
  const actor = await getFiefActor();
  if (!actor || (!actor.member && !actor.manager)) return fail(403, "Réservé aux membres FIEF.");
  const docId = request.headers.get("x-document-id") ?? "";
  const contentRange = request.headers.get("content-range");
  if (!/^[0-9a-f-]{36}$/i.test(docId) || !contentRange) return fail(400, "Requête invalide.");

  const service = createServiceClient();
  const { data: doc } = await service.from("fief_documents").select("id, owner_id, status, upload_url, mime_type, as_team, name").eq("id", docId).maybeSingle();
  if (!doc || doc.owner_id !== actor.userId) return fail(404, "Envoi introuvable.");
  if (doc.status !== "uploading" || !doc.upload_url) return fail(409, "Ce document est déjà envoyé.");

  const buffer = Buffer.from(await request.arrayBuffer());
  const googleRes = await fetch(doc.upload_url, {
    method: "PUT",
    headers: { "Content-Range": contentRange, "Content-Length": String(buffer.length), "Content-Type": doc.mime_type },
    body: buffer.length ? buffer : undefined,
  });

  if (googleRes.status === 308) return new NextResponse(null, { status: 308, headers: { "x-range": googleRes.headers.get("range") ?? "" } });
  if (!googleRes.ok) {
    console.error("[fief.documents.chunk]", googleRes.status, (await googleRes.text()).slice(0, 300));
    return fail(502, "Le Drive a refusé ce morceau : réessayez.");
  }
  const { id: storageId } = (await googleRes.json()) as { id: string };
  const { error } = await service.from("fief_documents").update({ status: "ready", storage_id: storageId, upload_url: null }).eq("id", doc.id);
  if (error) return fail(500, "Document envoyé mais non enregistré.");

  if (doc.as_team) {
    const { data: members } = await service.from("fief_members").select("user_id").eq("status", "active").neq("user_id", actor.userId);
    await notifyFief((members ?? []).map((m) => m.user_id), {
      kind: "info",
      title: "Nouveau document partagé par l'équipe FIEF",
      body: doc.name,
      route: "/documents",
      tag: `fief-doc-${doc.id}`,
    });
  }
  return NextResponse.json({ ok: true, id: doc.id });
}
