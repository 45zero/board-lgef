import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Jetons des boutons d'action des e-mails de notification (Accepter, Refuser…). Signés (HMAC) avec
// EMAIL_ACTION_SECRET, à défaut TOKEN_ENCRYPTION_KEY : ils désignent une notification et son
// destinataire, et expirent. Le lien ouvre /action/<jeton>, qui demande une confirmation avant
// d'agir (les antivirus de messagerie ouvrent les liens tout seuls).

export type ActionTokenPayload = { n: string; u: string; exp: number };

const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.EMAIL_ACTION_SECRET ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!s) throw new Error("EMAIL_ACTION_SECRET (ou TOKEN_ENCRYPTION_KEY) manquant.");
  return s;
}

const sign = (body: string) => createHmac("sha256", secret()).update(`email-action:${body}`).digest("base64url");

export function createActionToken(notificationId: string, userId: string): string {
  const body = Buffer.from(JSON.stringify({ n: notificationId, u: userId, exp: Date.now() + TTL_MS } satisfies ActionTokenPayload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyActionToken(token: string): ActionTokenPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ActionTokenPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
