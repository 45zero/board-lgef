import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Relaie un morceau de fichier vers la session resumable Drive côté serveur.
 * Nécessaire car l'API Drive n'autorise pas le PUT direct navigateur→Google
 * (CORS bloqué) et qu'un fichier entier dépasserait la limite de taille de
 * requête de l'hébergeur — chaque morceau reste petit, transite par ici.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  }

  const uploadUrl = request.headers.get("x-upload-url");
  const contentRange = request.headers.get("content-range");
  const contentType = request.headers.get("x-file-content-type") || "application/octet-stream";

  if (!uploadUrl || !contentRange) {
    return NextResponse.json({ ok: false, error: "En-têtes manquants" }, { status: 400 });
  }
  if (!uploadUrl.startsWith("https://www.googleapis.com/upload/drive/")) {
    return NextResponse.json({ ok: false, error: "URL d'upload invalide" }, { status: 400 });
  }

  const buffer = Buffer.from(await request.arrayBuffer());

  const googleRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Range": contentRange,
      "Content-Length": String(buffer.length),
      "Content-Type": contentType,
    },
    body: buffer,
  });

  if (googleRes.status === 308) {
    return new NextResponse(null, { status: 308 });
  }
  if (!googleRes.ok) {
    const text = await googleRes.text();
    return NextResponse.json({ ok: false, error: text }, { status: googleRes.status });
  }

  const json = await googleRes.json();
  return NextResponse.json({ ok: true, ...json });
}
