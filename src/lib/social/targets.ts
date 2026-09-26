// Types et cibles partagés client/serveur pour la publication Facebook/Instagram — les comptes
// (id de page, token) vivent côté serveur dans SOCIAL_ACCOUNTS_JSON (voir accounts.ts), le client
// ne manipule que ces clés.

export type SocialPlateforme = "FACEBOOK" | "INSTAGRAM";

export type FacebookRegion = "lorraine" | "champagne_ardenne" | "alsace";
export type SocialTargetKey = FacebookRegion | "instagram";

export const SOCIAL_TARGETS: { key: SocialTargetKey; label: string; plateforme: SocialPlateforme; accountId: string }[] = [
  { key: "lorraine", label: "Lorraine", plateforme: "FACEBOOK", accountId: "fb-lorraine" },
  { key: "champagne_ardenne", label: "Champagne-Ardenne", plateforme: "FACEBOOK", accountId: "fb-champagne-ardenne" },
  { key: "alsace", label: "Alsace", plateforme: "FACEBOOK", accountId: "fb-alsace" },
  { key: "instagram", label: "@lgefofficiel", plateforme: "INSTAGRAM", accountId: "ig-lgefofficiel" },
];

export const FACEBOOK_REGIONS = SOCIAL_TARGETS.filter((t) => t.plateforme === "FACEBOOK") as {
  key: FacebookRegion;
  label: string;
  plateforme: "FACEBOOK";
  accountId: string;
}[];

/**
 * Stats lues sur Meta et figées dans publish_info au dernier rafraîchissement. `reach` n'existe que
 * sur Instagram (la portée d'un post Facebook exige read_insights, non accordé aux tokens de page),
 * `shares` que sur Facebook.
 */
export interface SocialStats {
  views?: number;
  reach?: number;
  likes: number;
  comments: number;
  shares?: number;
  fetchedAt: string;
}

export type SocialComment = { id: string; author: string; text: string; createdAt: string };

/** Instagram n'accepte que du JPEG en image (et exige toujours un média) — les autres formats restent publiables sur Facebook. */
export function isInstagramCompatible(contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  return ct.startsWith("video") || ct === "image/jpeg" || ct === "image/jpg";
}
