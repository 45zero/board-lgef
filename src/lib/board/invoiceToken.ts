import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Lien de dépôt de factures envoyé par e-mail à un prestataire (« Réclamer » dans l'Effectif) :
// /facture/<jeton>. Le jeton porte le prestataire, la ou les interventions (événements) concernées,
// qui les a réclamées, son commentaire et une échéance, signé HMAC (TOKEN_ENCRYPTION_KEY, comme
// mediaStreamToken) — rien n'est stocké en base.

export type InvoiceTokenPayload = { eventIds: string[]; userId: string; requesterId: string; comment: string | null; expiresAt: number };

const VALIDITY_MS = 45 * 86_400_000;

function secret() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY manquante");
  return key;
}

const sign = (body: string) => createHmac("sha256", secret()).update(`invoice:${body}`).digest("base64url");

export function createInvoiceToken(p: Omit<InvoiceTokenPayload, "expiresAt">): string {
  const body = Buffer.from(
    JSON.stringify({ e: p.eventIds, u: p.userId, r: p.requesterId, ...(p.comment ? { c: p.comment.slice(0, 500) } : {}), x: Date.now() + VALIDITY_MS })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Contenu du jeton s'il est intact et non expiré, sinon null (accepte l'ancien format à un seul événement). */
export function readInvoiceToken(token: string): InvoiceTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const a = Buffer.from(sign(body));
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { e, u, r, c, x } = JSON.parse(Buffer.from(body, "base64url").toString()) as { e: string | string[]; u: string; r: string; c?: string; x: number };
    const eventIds = (Array.isArray(e) ? e : [e]).filter(Boolean);
    if (!eventIds.length || !u || !x || Date.now() > x) return null;
    return { eventIds, userId: u, requesterId: r, comment: c ?? null, expiresAt: x };
  } catch {
    return null;
  }
}
