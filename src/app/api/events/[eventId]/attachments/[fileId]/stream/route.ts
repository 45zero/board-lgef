import { NextResponse } from "next/server";
import { getGoogleAccountById, getValidGoogleAccessToken } from "@/lib/google/accounts";
import { getBoardDriveAccountId } from "@/app/actions/board-settings";
import { verifyMediaStreamToken } from "@/lib/board/mediaStreamToken";

/**
 * Relais public (mais signé, courte durée) d'un fichier du Drive du board —
 * seul moyen pour les Edge Functions publish-youtube/publish-facebook (fetch
 * serveur-à-serveur, sans cookie de session) de récupérer les octets d'une
 * vidéo qui n'est plus sur Supabase Storage.
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const { searchParams } = new URL(request.url);
  const expiresAt = Number(searchParams.get("expires"));
  const signature = searchParams.get("sig") ?? "";

  if (!expiresAt || !signature || !verifyMediaStreamToken(fileId, expiresAt, signature)) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  const boardDriveAccountId = await getBoardDriveAccountId();
  const account = boardDriveAccountId ? await getGoogleAccountById(boardDriveAccountId) : null;
  if (!account) {
    return NextResponse.json({ error: "Aucun Drive de board configuré" }, { status: 404 });
  }

  const accessToken = await getValidGoogleAccessToken(account);
  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!driveRes.ok || !driveRes.body) {
    return NextResponse.json({ error: "Fichier introuvable sur Drive" }, { status: driveRes.status || 502 });
  }

  return new NextResponse(driveRes.body, {
    status: 200,
    headers: {
      "Content-Type": driveRes.headers.get("content-type") ?? "application/octet-stream",
      "Content-Length": driveRes.headers.get("content-length") ?? "",
    },
  });
}
