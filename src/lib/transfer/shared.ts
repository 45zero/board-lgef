// LGEF Transfer — types et utilitaires communs au navigateur et au serveur.

export type TransferPlanLimits = {
  id: string;
  name: string;
  /** null = illimité */
  maxSizeBytes: number | null;
  maxDays: number | null;
  canArchive: boolean;
};

export type TransferAdView = {
  id: string;
  mediaType: "image" | "video";
  format: "wallpaper" | "banner";
  mediaUrl: string;
  clickUrl: string | null;
  advertiser: string;
};

export type TransferPreview =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "iframe"; url: string }
  | { kind: "none" };

export type UploadTarget ={ fileRowId: string; uploadUrl: string; relay: boolean };

export const GB = 1024 * 1024 * 1024;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/** Durées proposées à l'expéditeur, filtrées par sa formule (null = « sans expiration »). */
export function durationChoices(maxDays: number | null): (number | null)[] {
  const base = [1, 3, 7, 14, 30, 60, 90, 365];
  if (maxDays === null) return [...base, null];
  const list = base.filter((d) => d <= maxDays);
  if (!list.includes(maxDays)) list.push(maxDays);
  return list;
}

export const durationLabel = (d: number | null) => (d === null ? "Sans expiration" : d === 1 ? "1 jour" : d === 365 ? "1 an" : `${d} jours`);

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "other";

export function fileKind(mime: string, name = ""): FileKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "other";
}
