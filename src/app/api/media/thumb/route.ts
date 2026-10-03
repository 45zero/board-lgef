import { NextResponse } from "next/server";
import { getGoogleAccountById, getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyMediaStreamToken } from "@/lib/board/mediaStreamToken";

/**
 * Miniature d'un fichier du Drive du board (photo ou vidéo) pour l'accueil — « Derniers médias
 * publiés ». Lien signé (jeton « thumb: », voir recent-posts.ts) : la miniature Google (≈ 480 px)
 * est relayée au lieu du fichier complet, et mise en cache par le navigateur.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("f") ?? "";
  const expiresAt = Number(searchParams.get("e"));
  const signature = searchParams.get("s") ?? "";
  if (!fileId || !expiresAt || !verifyMediaStreamToken(`thumb:${fileId}`, expiresAt, signature)) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  const { data: settings } = await createServiceClient().from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  const account = settings?.drive_connected_account_id ? await getGoogleAccountById(settings.drive_connected_account_id) : null;
  if (!account) return NextResponse.json({ error: "Aucun Drive de board configuré" }, { status: 404 });

  const accessToken = await getValidGoogleAccessToken(account);
  const auth = { Authorization: `Bearer ${accessToken}` };
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`, { headers: auth });
  const link = meta.ok ? ((await meta.json()) as { thumbnailLink?: string }).thumbnailLink : undefined;
  if (!link) return NextResponse.json({ error: "Pas de miniature" }, { status: 404 });

  const img = await fetch(link.replace(/=s\d+$/, "=s480"), { headers: auth });
  if (!img.ok || !img.body) return NextResponse.json({ error: "Miniature indisponible" }, { status: 502 });
  return new NextResponse(img.body, {
    status: 200,
    headers: { "Content-Type": img.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
