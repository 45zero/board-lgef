import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Jeton signé de courte durée pour le relais de streaming Drive (route
 * /api/events/[eventId]/attachments/[fileId]/stream) — appelé sans cookie de
 * session par les Edge Functions publish-youtube/publish-facebook, donc pas
 * d'auth Supabase classique possible ici. Réutilise TOKEN_ENCRYPTION_KEY (déjà
 * en place pour chiffrer les tokens Google) comme secret HMAC.
 */
function getSecret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY manquante");
  return key;
}

export function signMediaStreamToken(fileId: string, expiresAt: number): string {
  return createHmac("sha256", getSecret()).update(`${fileId}:${expiresAt}`).digest("hex");
}

export function verifyMediaStreamToken(fileId: string, expiresAt: number, signature: string): boolean {
  if (Date.now() > expiresAt) return false;
  const expected = signMediaStreamToken(fileId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
