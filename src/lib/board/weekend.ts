// Module Week-end : matchs du week-end à photographier/filmer, réseau photo, récapitulatif des
// publications par page régionale. Types et fonctions partagés client/serveur.

import type { FacebookRegion } from "@/lib/social/targets";

export type PhotoStatus = "draft" | "open" | "taken";

export type PersonLite = { id: string; name: string; firstName: string };

export interface MatchDetails {
  competition: string;
  homeTeam: string;
  homeLevel: string;
  awayTeam: string;
  awayLevel: string;
  regions: FacebookRegion[];
}

export interface WeekendMatch {
  eventId: string;
  title: string;
  start: string;
  location: string;
  /** Nul pour un « match du week-end » créé sans affiche (ancien calendrier). */
  details: MatchDetails | null;
  /** Poste photo ; nul si le match n'est pas à photographier. */
  photo: {
    missionId: string;
    status: PhotoStatus;
    photographer: PersonLite | null;
    publisher: PersonLite | null;
  } | null;
  /**
   * Captation vidéo (coverage_requests) ; nulle si aucune demande. open : personne de désigné ;
   * pending : vidéaste proposé, réponse attendue ; accepted : confirmé ; no : demande refusée.
   */
  video: { state: "open" | "pending" | "accepted" | "no"; technician: string | null } | null;
  /** Photos déposées sur l'événement. */
  photoCount: number;
  /** Un album photo de l'événement est publié. */
  photosPublished: boolean;
}

export interface WeekendData {
  viewer: { id: string; canCoordinate: boolean; isPhotographer: boolean; isAdmin: boolean };
  matches: WeekendMatch[];
  /** Photographes (coordinateurs uniquement). */
  photographers: PersonLite[];
  /** Réseau Couverture match : photographes et vidéastes (coordinateurs uniquement). */
  network: { person: PersonLite; photo: boolean; video: boolean }[];
  /** Relais de publication possibles (coordinateurs uniquement). */
  publishers: PersonLite[];
}

export interface MatchInput {
  /** ISO — date et heure du coup d'envoi. */
  start: string;
  location: string;
  competition: string;
  homeTeam: string;
  homeLevel: string;
  awayTeam: string;
  awayLevel: string;
  regions: FacebookRegion[];
  photo: boolean;
  /** Désignation directe ; nul : proposé au réseau. */
  photographerId: string | null;
  publisherId: string | null;
  video: boolean;
}

/** Compétitions proposées à la saisie (texte libre accepté). */
export const COMPETITION_SUGGESTIONS = [
  "CF-CA 4T",
  "CF-CA 5T",
  "CF-CA 6T",
  "CGE 2T",
  "CGE 3T",
  "CFFém 2T",
  "R1",
  "R2",
  "R3",
  "R1 Futsal",
  "R1 Féminine",
  "U20 R1",
  "U18 R1",
  "U17 R1",
  "U16 R1",
  "U15 R1",
  "U15 R2",
];

export const LEVEL_SUGGESTIONS = ["N1", "N2", "N3", "R1", "R2", "R3", "D1", "D2", "D3", "D4", "D1F", "D2F", "R1F", "R2F"];

export function matchLabel(d: Pick<MatchDetails, "competition" | "homeTeam" | "homeLevel" | "awayTeam" | "awayLevel">) {
  const team = (name: string, level: string) => (level.trim() ? `${name.trim()} (${level.trim()})` : name.trim());
  return `${d.competition.trim()} : ${team(d.homeTeam, d.homeLevel)} – ${team(d.awayTeam, d.awayLevel)}`;
}

/** Week-end (vendredi 0 h → lundi 0 h, heure locale) contenant `date`, ou le prochain en semaine. */
export function weekendOf(date: Date) {
  const day = date.getDay(); // 0 = dimanche
  const offsetToFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetToFriday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
  return { start, end };
}

export function shiftWeekend(start: Date, weeks: number) {
  return weekendOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * weeks + 1));
}

export function weekendLabel(start: Date) {
  const sat = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const sun = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 2);
  const d = (x: Date, opts: Intl.DateTimeFormatOptions) => x.toLocaleDateString("fr-FR", opts);
  return sat.getMonth() === sun.getMonth()
    ? `Week-end du ${d(sat, { day: "numeric" })} au ${d(sun, { day: "numeric", month: "long" })}`
    : `Week-end du ${d(sat, { day: "numeric", month: "long" })} au ${d(sun, { day: "numeric", month: "long" })}`;
}

export const REGION_ORDER: FacebookRegion[] = ["alsace", "lorraine", "champagne_ardenne"];
const REGION_RECAP: Record<FacebookRegion, string> = { alsace: "ALSACE", lorraine: "LORRAINE", champagne_ardenne: "CHAMPAGNE/ARDENNE" };
export const REGION_LABELS: Record<FacebookRegion, string> = { alsace: "Alsace", lorraine: "Lorraine", champagne_ardenne: "Champagne-Ardenne" };

/** Clé de regroupement « pages » d'un match : régions triées, ou « autres » sans affiche/page. */
export function regionsKey(m: WeekendMatch) {
  const regions = [...(m.details?.regions ?? [])].sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
  return regions.length ? regions.join("+") : "";
}

export function regionsGroupLabel(key: string, style: "recap" | "ui") {
  if (!key) return style === "recap" ? "SANS PAGE" : "Sans page choisie";
  const regions = key.split("+") as FacebookRegion[];
  if (style === "ui") return regions.map((r) => REGION_LABELS[r]).join(" + ");
  return `PUBLI PAGE${regions.length > 1 ? "S" : ""} LGEF ${regions.map((r) => REGION_RECAP[r]).join(" ET ")}`;
}

/** Ordre des groupes : pages seules (Alsace, Lorraine, Champagne-Ardenne), puis les combinaisons. */
export function compareRegionKeys(a: string, b: string) {
  const rank = (k: string) => {
    if (!k) return 1000;
    const parts = k.split("+");
    return parts.length * 10 + REGION_ORDER.indexOf(parts[0] as FacebookRegion);
  };
  return rank(a) - rank(b);
}

/** « (Photos Damien/Publi Olivier + Vidéo Kévin) » — même convention que le récap manuel. */
export function recapCredits(m: WeekendMatch) {
  const photoName = m.photo?.status === "taken" ? m.photo.photographer?.firstName ?? null : null;
  const publi = m.photo?.publisher ? `/Publi ${m.photo.publisher.firstName}` : "";
  const videoName = m.video?.state === "accepted" ? m.video.technician?.split(" ")[0] ?? "?" : null;
  const parts: string[] = [];
  if (m.photo) parts.push(photoName ? `${m.video ? "Photos " : ""}${photoName}${publi}` : `${m.video ? "Photos " : ""}à pourvoir`);
  if (m.video) parts.push(`Vidéo ${videoName ?? "à pourvoir"}`);
  return parts.length ? ` (${parts.join(" + ")})` : "";
}

export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayHeading(iso: string, style: "recap" | "ui") {
  const d = new Date(iso);
  if (style === "ui") {
    const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const weekday = d.toLocaleDateString("fr-FR", { weekday: "long" }).toUpperCase();
  return `${weekday} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Matchs regroupés par pages puis par jour, dans l'ordre du récap. */
export function groupMatches(matches: WeekendMatch[]) {
  const byRegion = new Map<string, WeekendMatch[]>();
  for (const m of [...matches].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = regionsKey(m);
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key)!.push(m);
  }
  return [...byRegion.entries()]
    .sort(([a], [b]) => compareRegionKeys(a, b))
    .map(([key, list]) => {
      const days = new Map<string, WeekendMatch[]>();
      for (const m of list) {
        const k = dayKey(m.start);
        if (!days.has(k)) days.set(k, []);
        days.get(k)!.push(m);
      }
      return { key, days: [...days.entries()].map(([day, items]) => ({ day, items })) };
    });
}

/** Texte du récapitulatif, au format du récap envoyé jusqu'ici à la main. */
export function buildRecap(matches: WeekendMatch[]) {
  return groupMatches(matches)
    .map(({ key, days }) =>
      [
        regionsGroupLabel(key, "recap"),
        ...days.flatMap(({ items }) => [
          dayHeading(items[0].start, "recap"),
          ...items.map((m) => `- ${m.details ? matchLabel(m.details) : m.title}${recapCredits(m)}`),
        ]),
      ].join("\n")
    )
    .join("\n \n");
}
