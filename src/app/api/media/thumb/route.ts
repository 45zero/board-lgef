import { NextResponse } from "next/server";
import sharp from "sharp";
import { getGoogleAccountById, getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyMediaStreamToken } from "@/lib/board/mediaStreamToken";

/**
 * Miniature d'un fichier du Drive du board (photo ou vidéo) ou d'une photo du stockage Supabase pour l'accueil — « Derniers médias
 * publiés », « Médias à publier ». Lien signé (jeton « thumb: », voir publicationThumbs.ts) : la miniature Google (≈ 480 px)
 * est relayée au lieu du fichier complet, gardée en mémoire et mise en cache par le navigateur.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // f : fichier du Drive du board ; p : photo du stockage Supabase (event-files), réduite ici.
  const storagePath = searchParams.get("p");
  const fileId = storagePath ? `p:${storagePath}` : (searchParams.get("f") ?? "");
  const expiresAt = Number(searchParams.get("e"));
  const signature = searchParams.get("s") ?? "";
  if (!fileId || !expiresAt || !verifyMediaStreamToken(`thumb:${fileId}`, expiresAt, signature)) {
    return NextResponse.json({ error: "Lien invalide ou expiré" }, { status: 403 });
  }

  const cached = thumbCache.get(fileId);
  if (cached) return image(cached);

  if (storagePath) {
    const { data } = await createServiceClient().storage.from("event-files").download(storagePath);
    if (!data) return NextResponse.json({ error: "Photo introuvable" }, { status: 404 });
    try {
      const jpeg = await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize(480, 480, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
      return image(remember(fileId, { bytes: new Uint8Array(jpeg).buffer, type: "image/jpeg" }));
    } catch {
      return NextResponse.json({ error: "Format d'image non pris en charge" }, { status: 415 });
    }
  }

  const accessToken = await boardDriveToken();
  if (!accessToken) return NextResponse.json({ error: "Aucun Drive de board configuré" }, { status: 404 });
  const auth = { Authorization: `Bearer ${accessToken}` };
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`, { headers: auth });
  const link = meta.ok ? ((await meta.json()) as { thumbnailLink?: string }).thumbnailLink : undefined;
  if (!link) return NextResponse.json({ error: "Pas de miniature" }, { status: 404 });

  const img = await fetch(link.replace(/=s\d+$/, "=s480"), { headers: auth });
  if (!img.ok) return NextResponse.json({ error: "Miniature indisponible" }, { status: 502 });
  return image(remember(fileId, { bytes: await img.arrayBuffer(), type: img.headers.get("content-type") ?? "image/jpeg" }));
}

// Mémoire de l'instance serveur : une miniature n'est demandée qu'une fois à Google, et le jeton
// du Drive du board est réutilisé tant qu'il est valide (au lieu de deux requêtes base par image).
const MAX_CACHED = 300;
const thumbCache = new Map<string, { bytes: ArrayBuffer; type: string }>();
let token: { value: string; until: number } | null = null;

async function boardDriveToken() {
  if (token && token.until > Date.now()) return token.value;
  const { data: settings } = await createServiceClient().from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  const account = settings?.drive_connected_account_id ? await getGoogleAccountById(settings.drive_connected_account_id) : null;
  if (!account) return null;
  // Jeton encore valide un moment : gardé jusqu'à 1 min avant son expiration ; sinon il vient d'être
  // rafraîchi (valable 1 h). Dans tous les cas, relu au plus tard dans 10 min.
  const left = account.token_expires_at.getTime() - Date.now();
  const value = await getValidGoogleAccessToken(account);
  token = { value, until: Date.now() + Math.min(10 * 60_000, left > 120_000 ? left - 60_000 : 10 * 60_000) };
  return value;
}

/** Cache borné : les plus anciennes miniatures sortent d'abord. */
function remember(key: string, entry: { bytes: ArrayBuffer; type: string }) {
  thumbCache.set(key, entry);
  if (thumbCache.size > MAX_CACHED) thumbCache.delete(thumbCache.keys().next().value!);
  return entry;
}

function image(entry: { bytes: ArrayBuffer; type: string }) {
  return new NextResponse(entry.bytes, { status: 200, headers: { "Content-Type": entry.type, "Cache-Control": "private, max-age=86400" } });
}
