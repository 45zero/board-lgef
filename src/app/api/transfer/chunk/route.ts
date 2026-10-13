import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyToken } from "@/lib/transfer/core";

export const maxDuration = 60;

/**
 * LGEF Transfer : relaie un morceau de fichier vers la session d'envoi du Drive Google (le navigateur
 * ne peut pas viser Google directement — CORS). Sans session : le jeton d'envoi signé fait foi
 * (transfert encore « en cours d'envoi », ou « ads » pour les fichiers de pub déposés par un admin).
 * Corps vide + `Content-Range: bytes *\/<taille>` : demande où en est l'envoi (reprise après coupure).
 */
export async function PUT(request: Request) {
  const transferId = request.headers.get("x-transfer-id") ?? "";
  const token = request.headers.get("x-transfer-token");
  const uploadUrl = request.headers.get("x-upload-url");
  const contentRange = request.headers.get("content-range");
  const contentType = request.headers.get("x-file-content-type") || "application/octet-stream";

  if (!verifyToken("upload", transferId, token)) return NextResponse.json({ ok: false, error: "Envoi expiré — recommencez." }, { status: 401 });
  if (!uploadUrl?.startsWith("https://www.googleapis.com/upload/drive/") || !contentRange) {
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: 400 });
  }
  if (transferId !== "ads") {
    const { data: t } = await createServiceClient().from("transfers").select("status").eq("id", transferId).maybeSingle();
    if (t?.status !== "uploading") return NextResponse.json({ ok: false, error: "Ce transfert n'accepte plus de fichiers." }, { status: 409 });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  const googleRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Range": contentRange, "Content-Length": String(buffer.length), "Content-Type": contentType },
    body: buffer.length ? buffer : undefined,
  });

  if (googleRes.status === 308) {
    return new NextResponse(null, { status: 308, headers: { "x-range": googleRes.headers.get("range") ?? "" } });
  }
  if (!googleRes.ok) {
    return NextResponse.json({ ok: false, error: (await googleRes.text()).slice(0, 300) }, { status: googleRes.status });
  }
  const json = await googleRes.json();
  return NextResponse.json({ ok: true, id: json.id });
}
