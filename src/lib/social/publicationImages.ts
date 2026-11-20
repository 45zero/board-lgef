import "server-only";
import sharp from "sharp";
import { getGoogleAccountById, getValidGoogleAccessToken } from "@/lib/google/accounts";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Aperçus des médias d'une publication montrés à Claude pour rédiger le texte (captionWriter.ts) :
// miniature Google pour les fichiers du Drive du board (photos et vidéos : Drive fournit une image
// de la vidéo), photo réduite pour le stockage Supabase. JPEG ~768 px : assez pour reconnaître la
// scène, léger en jetons. Un aperçu introuvable est simplement ignoré.

export type MediaRef = { driveFileId: string | null; storagePath: string | null; contentType: string | null };

const MAX_IMAGES = 6;
const SIZE = 768;

async function boardDriveToken(): Promise<string | null> {
  const { data: settings } = await createServiceClient().from("board_settings").select("drive_connected_account_id").eq("id", true).single();
  const account = settings?.drive_connected_account_id ? await getGoogleAccountById(settings.drive_connected_account_id) : null;
  return account ? getValidGoogleAccessToken(account) : null;
}

async function toJpegBase64(bytes: ArrayBuffer): Promise<string> {
  const jpeg = await sharp(Buffer.from(bytes)).rotate().resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return jpeg.toString("base64");
}

/** Jusqu'à 6 médias répartis sur tout l'album (début, milieu, fin), pas seulement les premiers. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

/** Aperçus JPEG en base64 (sans préfixe data:). */
export async function publicationPreviewImages(media: MediaRef[]): Promise<string[]> {
  const usable = media.filter((m) => m.driveFileId || (m.storagePath && (m.contentType ?? "").startsWith("image")));
  const picked = spread(usable, MAX_IMAGES);
  if (picked.length === 0) return [];

  const token = picked.some((m) => m.driveFileId) ? await boardDriveToken().catch(() => null) : null;
  const one = async (m: MediaRef): Promise<string | null> => {
    try {
      if (m.driveFileId) {
        if (!token) return null;
        const auth = { Authorization: `Bearer ${token}` };
        const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(m.driveFileId)}?fields=thumbnailLink`, { headers: auth });
        const link = meta.ok ? ((await meta.json()) as { thumbnailLink?: string }).thumbnailLink : undefined;
        if (!link) return null;
        const img = await fetch(link.replace(/=s\d+$/, `=s${SIZE}`), { headers: auth });
        return img.ok ? toJpegBase64(await img.arrayBuffer()) : null;
      }
      const { data } = await createServiceClient().storage.from("event-files").download(m.storagePath!);
      return data ? toJpegBase64(await data.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
  const out = await Promise.all(picked.map(one));
  return out.filter((x): x is string => !!x);
}
