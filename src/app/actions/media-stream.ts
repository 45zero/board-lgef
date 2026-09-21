"use server";

import { signMediaStreamToken } from "@/lib/board/mediaStreamToken";

/** Lien signé temporaire (30 min) vers un fichier du Drive du board — pour que les Edge Functions de publication puissent le fetch sans session. */
export async function getDriveStreamUrl(eventId: string, fileId: string) {
  const expiresAt = Date.now() + 30 * 60_000;
  const sig = signMediaStreamToken(fileId, expiresAt);
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  return `${base}/api/events/${eventId}/attachments/${fileId}/stream?expires=${expiresAt}&sig=${sig}`;
}
