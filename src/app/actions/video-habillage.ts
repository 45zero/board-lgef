"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { isPublisher } from "@/lib/board/publishers";

// Habillage des vidéos : le téléphone dépose la vidéo et le calque (PNG transparent) dans le bucket
// privé video-work, la route /api/media/video-habillage les assemble avec FFmpeg, puis le résultat
// est récupéré et supprimé. Réservé aux personnes habilitées à publier.

const BUCKET = "video-work";

async function currentPublisher() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  if (!(await isPublisher(supabase, userId))) throw new Error("Vous n'êtes pas habilité à publier.");
  return userId;
}

/** Deux URL de dépôt signées : la vidéo d'origine et le calque d'habillage. */
export async function createVideoWorkUploads(
  videoName: string
): Promise<{ video: { path: string; token: string }; overlay: { path: string; token: string } }> {
  const userId = await currentPublisher();
  const ext = (videoName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const id = randomUUID();
  const service = createServiceClient();
  const sign = async (path: string) => {
    const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Dépôt impossible.");
    return { path, token: data.token };
  };
  const [video, overlay] = await Promise.all([sign(`${userId}/${id}.${ext}`), sign(`${userId}/${id}-overlay.png`)]);
  return { video, overlay };
}

/** Supprime un fichier de travail (le résultat, une fois récupéré par le téléphone). */
export async function removeVideoWork(path: string) {
  const userId = await currentPublisher();
  if (!path.startsWith(`${userId}/`) || path.includes("..")) return;
  await createServiceClient().storage.from(BUCKET).remove([path]);
}
