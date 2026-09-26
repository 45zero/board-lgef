import "server-only";
import { signMediaStreamToken, verifyMediaStreamToken } from "@/lib/board/mediaStreamToken";

// URLs signées (30 min) des routes de conversion appelées par Meta sans session :
// - /api/media/jpeg : convertit une image (PNG, WebP…) en JPEG — Instagram n'accepte que le JPEG ;
// - /api/media/text-card : génère un visuel à partir d'un texte — Instagram n'accepte pas de post
//   texte seul. Signées pour qu'elles ne servent pas de relais/générateur ouvert à tous.

const TTL_MS = 30 * 60_000;

function base() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

export function signedJpegUrl(sourceUrl: string): string {
  const e = Date.now() + TTL_MS;
  const s = signMediaStreamToken(`jpeg:${sourceUrl}`, e);
  return `${base()}/api/media/jpeg?u=${encodeURIComponent(sourceUrl)}&e=${e}&s=${s}`;
}

export function signedTextCardUrl(text: string): string {
  const e = Date.now() + TTL_MS;
  const s = signMediaStreamToken(`card:${text}`, e);
  return `${base()}/api/media/text-card?t=${encodeURIComponent(text)}&e=${e}&s=${s}`;
}

export function verifySignedParam(kind: "jpeg" | "card", value: string, e: string | null, s: string | null): boolean {
  const expiresAt = Number(e);
  if (!value || !expiresAt || !s) return false;
  return verifyMediaStreamToken(`${kind}:${value}`, expiresAt, s);
}
