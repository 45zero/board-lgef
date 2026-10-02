import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import { cardFileInfo, getBoardDriveAccount } from "@/lib/board/teamDrive";

/**
 * Télécharge une pièce jointe d'une carte de l'Espace Team depuis le Drive du board : réservé à qui
 * voit la carte (RLS de team_cards), et seulement pour un fichier de la carte (son dossier, ou un
 * fichier de l'événement lié déposé depuis la carte).
 * `?inline=1` l'affiche dans le navigateur (aperçu).
 */
export async function GET(request: Request, { params }: { params: Promise<{ cardId: string; fileId: string }> }) {
  const { cardId, fileId } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: card } = await supabase.from("team_cards").select("id").eq("id", cardId).maybeSingle();
  if (!card) return NextResponse.json({ error: "Carte introuvable ou non accessible" }, { status: 404 });

  const account = await getBoardDriveAccount();
  if (!account) return NextResponse.json({ error: "Aucun Drive de board configuré" }, { status: 404 });
  const file = await cardFileInfo(account, cardId, fileId);
  if (!file) {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  const accessToken = await getValidGoogleAccessToken(account);
  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!driveRes.ok || !driveRes.body) return NextResponse.json({ error: "Fichier illisible sur Drive" }, { status: driveRes.status || 502 });

  const headers: Record<string, string> = {
    "Content-Type": driveRes.headers.get("content-type") ?? "application/octet-stream",
    // ?inline=1 : aperçu dans le navigateur (œil de la fiche carte) plutôt que téléchargement.
    "Content-Disposition": `${new URL(request.url).searchParams.get("inline") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Cache-Control": "private, no-store",
  };
  const length = driveRes.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  return new NextResponse(driveRes.body, { status: 200, headers });
}
