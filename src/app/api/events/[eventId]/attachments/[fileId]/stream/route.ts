import { NextResponse } from "next/server";
import { getGoogleAccountById, getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyMediaStreamToken } from "@/lib/board/mediaStreamToken";

/**
 * Relais public (mais signé, courte durée) d'un fichier du Drive du board —
 * seul moyen pour les Edge Functions publish-youtube/publish-facebook (fetch
 * serveur-à-serveur, sans cookie de session) de récupérer les octets d'une
 * vidéo qui n'est plus sur Supabase Storage. Sert aussi à ouvrir les fichiers
 * depuis le board : le lien Drive natif demanderait un accès au compte du board.
 * Les requêtes Range sont relayées (lecture vidéo et avance rapide, Safari les exige).
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const { searchParams } = new URL(request.url);
  const expiresAt = Number(searchParams.get("expires"));
  const signature = searchParams.get("sig") ?? "";

  if (!expiresAt || !signature || !verifyMediaStreamToken(fileId, expiresAt, signature)) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  // Appel sans session (Edge Functions) : la signature fait foi, le réglage est lu en service role
  // (board_settings n'est lisible que par les utilisateurs connectés).
  const { data: settings } = await createServiceClient().from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  const boardDriveAccountId = settings?.drive_connected_account_id ?? null;
  const account = boardDriveAccountId ? await getGoogleAccountById(boardDriveAccountId) : null;
  if (!account) {
    return NextResponse.json({ error: "Aucun Drive de board configuré" }, { status: 404 });
  }

  const accessToken = await getValidGoogleAccessToken(account);
  const range = request.headers.get("range");
  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...(range ? { Range: range } : {}) },
  });

  if (!driveRes.ok || !driveRes.body) {
    if (driveRes.status === 416) return new NextResponse(null, { status: 416, headers: { "Content-Range": driveRes.headers.get("content-range") ?? "" } });
    return NextResponse.json({ error: "Fichier introuvable sur Drive" }, { status: driveRes.status || 502 });
  }

  const headers: Record<string, string> = {
    "Content-Type": driveRes.headers.get("content-type") ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=1800",
  };
  const length = driveRes.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  const contentRange = driveRes.headers.get("content-range");
  if (contentRange) headers["Content-Range"] = contentRange;
  const download = searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
  return new NextResponse(driveRes.body, { status: driveRes.status === 206 ? 206 : 200, headers });
}
