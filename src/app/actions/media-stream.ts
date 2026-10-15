"use server";

import { createClient } from "@/lib/supabase/server";
import { signMediaStreamToken } from "@/lib/board/mediaStreamToken";

/**
 * Lien signé temporaire (30 min) vers un fichier du Drive du board, servi par le board : lisible par
 * les Edge Functions de publication (sans session) et par tout utilisateur connecté, sans demande
 * d'accès au Drive. `downloadAs` : téléchargement sous ce nom au lieu d'un affichage dans le navigateur.
 */
export async function getDriveStreamUrl(eventId: string, fileId: string, downloadAs?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");

  const expiresAt = Date.now() + 30 * 60_000;
  const sig = signMediaStreamToken(fileId, expiresAt);
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const download = downloadAs ? `&download=${encodeURIComponent(downloadAs)}` : "";
  return `${base}/api/events/${eventId}/attachments/${fileId}/stream?expires=${expiresAt}&sig=${sig}${download}`;
}
