import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Lien de dépôt de facture envoyé par e-mail à un prestataire (« Réclamer » dans l'Effectif) :
// /facture/<jeton>. Le jeton porte l'événement, le prestataire, qui l'a réclamée et une échéance,
// signé HMAC (TOKEN_ENCRYPTION_KEY, comme mediaStreamToken) — rien n'est stocké en base.

export type InvoiceTokenPayload = { eventId: string; userId: string; requesterId: string; expiresAt: number };

const VALIDITY_MS = 45 * 86_400_000;

function secret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY manquante");
  return key;
}

const sign = (body: string) => createHmac("sha256", secret()).update(`invoice:${body}`).digest("base64url");

export function createInvoiceToken(p: Omit<InvoiceTokenPayload, "expiresAt">): string {
  const body = Buffer.from(JSON.stringify({ e: p.eventId, u: p.userId, r: p.requesterId, x: Date.now() + VALIDITY_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Contenu du jeton s'il est intact et non expiré, sinon null. */
export function readInvoiceToken(token: string): InvoiceTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const a = Buffer.from(sign(body));
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { e, u, r, x } = JSON.parse(Buffer.from(body, "base64url").toString()) as { e: string; u: string; r: string; x: number };
    if (!e || !u || !x || Date.now() > x) return null;
    return { eventId: e, userId: u, requesterId: r, expiresAt: x };
  } catch {
    return null;
  }
}
