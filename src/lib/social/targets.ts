// Types et cibles partagés client/serveur pour le centre de publication — les comptes Meta
// (id de page, token) vivent côté serveur dans SOCIAL_ACCOUNTS_JSON (voir accounts.ts), la chaîne
// YouTube dans les secrets de l'Edge Function youtube-manage ; le client ne manipule que ces clés.

export type SocialPlateforme = "FACEBOOK" | "INSTAGRAM";

export type FacebookRegion = "lorraine" | "champagne_ardenne" | "alsace";
export type SocialTargetKey = FacebookRegion | "instagram";
/** Toutes les cibles d'une publication, YouTube compris (stats, commentaires, suppression). */
export type NetworkKey = SocialTargetKey | "youtube";

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

export function networkLabel(key: NetworkKey): string {
  if (key === "youtube") return "YouTube";
  const t = SOCIAL_TARGETS.find((x) => x.key === key)!;
  return t.plateforme === "INSTAGRAM" ? `Instagram ${t.label}` : `Facebook ${t.label}`;
}

/**
 * Stats lues sur la plateforme et figées dans publish_info au dernier rafraîchissement. `reach`
 * n'existe que sur Instagram (la portée d'un post Facebook exige read_insights, non accordé aux
 * tokens de page), `shares` que sur Facebook.
 */
export interface SocialStats {
  views?: number;
  reach?: number;
  likes: number;
  comments: number;
  shares?: number;
  fetchedAt: string;
}

export interface PublishTarget {
  published: boolean;
  at?: string;
  by?: { first_name: string | null; last_name: string | null } | null;
}

/**
 * État d'une publication sur un réseau : ids de la plateforme (vidéo pour une vidéo Facebook,
 * post/média sinon) et dernières stats connues. Les publications de l'ancienne Edge Function
 * n'ont que `published`/`at` — leur id Facebook est retrouvé au premier rafraîchissement.
 */
export interface SocialPublishTarget extends PublishTarget {
  videoId?: string;
  postId?: string;
  permalink?: string;
  mediaType?: "video" | "image" | "gallery" | "text";
  stats?: SocialStats;
}

export interface PublishInfo {
  youtube?: SocialPublishTarget & { title?: string };
  facebook?: Partial<Record<FacebookRegion, SocialPublishTarget>>;
  instagram?: SocialPublishTarget;
  /** Dernier échec d'un envoi programmé (affiché sur la publication). */
  lastError?: { at: string; message: string };
}

export function getNetworkEntry(info: PublishInfo | null | undefined, key: NetworkKey): SocialPublishTarget | undefined {
  if (!info) return undefined;
  if (key === "youtube") return info.youtube;
  if (key === "instagram") return info.instagram;
  return info.facebook?.[key];
}

export function withNetworkEntry(info: PublishInfo, key: NetworkKey, value: SocialPublishTarget | undefined): PublishInfo {
  if (key === "youtube") return { ...info, youtube: value };
  if (key === "instagram") return { ...info, instagram: value };
  return { ...info, facebook: { ...info.facebook, [key]: value } };
}

export const NETWORK_KEYS: NetworkKey[] = ["youtube", ...SOCIAL_TARGETS.map((t) => t.key)];

export type SocialComment = { id: string; author: string; text: string; createdAt: string };

export type SocialPublishResult = { key: NetworkKey; ok: boolean; error?: string };

/** Libellé lisible des échecs d'une opération multi-réseaux (null si tout est passé). */
export function describeFailures(results: SocialPublishResult[]): string | null {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  return failed.map((r) => `${networkLabel(r.key)} : ${r.error ?? "échec"}`).join("\n");
}

export function publishedNetworks(info: PublishInfo | null | undefined): NetworkKey[] {
  return NETWORK_KEYS.filter((k) => getNetworkEntry(info, k)?.published);
}

/* ---------- Types de publication ---------- */

export type PublicationKind = "video" | "photo" | "gallery" | "text";

export const PUBLICATION_KIND_LABELS: Record<PublicationKind, string> = {
  video: "Vidéo",
  photo: "Photo",
  gallery: "Galerie",
  text: "Texte",
};

/** Média d'une publication autonome (sans événement) — stocké sur le Drive du board, dossier Publications. */
export interface StandaloneMedia {
  drive_file_id: string;
  filename: string;
  content_type: string | null;
  web_view_link: string | null;
}

export function kindFromContentTypes(contentTypes: (string | null)[]): PublicationKind {
  if (contentTypes.length === 0) return "text";
  if (contentTypes.length > 1) return "gallery";
  return (contentTypes[0] ?? "").startsWith("video") ? "video" : "photo";
}

/**
 * Médias publiables sur Instagram : vidéos et toutes les images — celles qui ne sont pas en JPEG
 * (PNG, WebP…) sont converties à la volée côté serveur (voir src/lib/social/mediaUrls.ts).
 */
export function isInstagramCompatible(contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  return ct.startsWith("video") || (ct.startsWith("image") && !/heic|heif/.test(ct));
}

/* ---------- Sous-catégories des compétitions (déduites du titre) ---------- */

export type CompetitionTag = "r1" | "r2" | "r3" | "cdf" | "cge" | "autres";

export const COMPETITION_TAGS: { key: CompetitionTag; label: string }[] = [
  { key: "r1", label: "R1" },
  { key: "r2", label: "R2" },
  { key: "r3", label: "R3" },
  { key: "cdf", label: "Coupe de France" },
  { key: "cge", label: "Coupes du Grand Est" },
  { key: "autres", label: "Autres" },
];

/** « Coupe de France » / « CDF », « Coupe(s) du Grand Est » / « CGE » / « CGEF »…, puis R1/R2/R3 (« R1 », « R 1 », « R1F »…). */
export function competitionTag(title: string | null | undefined): CompetitionTag {
  const t = (title ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/coupe\s+de\s+france|\bcdf\b/i.test(t)) return "cdf";
  if (/coupes?\s+du\s+grand[\s-]*est|\bcgef?\w*\b/i.test(t)) return "cge";
  if (/\bR\s?1(?!\d)/i.test(t)) return "r1";
  if (/\bR\s?2(?!\d)/i.test(t)) return "r2";
  if (/\bR\s?3(?!\d)/i.test(t)) return "r3";
  return "autres";
}
