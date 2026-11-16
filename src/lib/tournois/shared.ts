import { z } from "zod";

// Tournois — types et règles partagés entre le formulaire public, la page de réponse et l'onglet du board.

export type DeclarationStatus = "received" | "reviewing" | "info_requested" | "validated" | "refused" | "cancelled";

export const STATUS_LABELS: Record<DeclarationStatus, string> = {
  received: "Reçue",
  reviewing: "En instruction",
  info_requested: "Complément demandé",
  validated: "Validée",
  refused: "Refusée",
  cancelled: "Annulée",
};

export const STATUS_TONES: Record<DeclarationStatus, string> = {
  received: "bg-sel-bg text-link",
  reviewing: "bg-warn-bg text-warn",
  info_requested: "bg-warn-bg text-warn",
  validated: "bg-good-bg text-good",
  refused: "bg-bad-bg text-bad",
  cancelled: "bg-subtle text-ink-3",
};

export const FORMAT_LABELS = {
  poules: "Poules",
  elimination: "Élimination directe",
  poules_elimination: "Poules puis élimination directe",
  plateau: "Plateau (sans classement)",
} as const;
export type MatchFormat = keyof typeof FORMAT_LABELS;

export const CATERING_LABELS = { internal: "Oui, gérée en interne", external: "Oui, prestataire extérieur", none: "Non" } as const;

// Pratique (**) de la fiche papier : Herbe / Futsal / Foot Indoor / Beach Soccer...
export const SURFACES = ["Herbe", "Futsal", "Foot Indoor", "Beach Soccer", "Autre"];

export const FILE_KIND_LABELS = { poster: "Affiche", rules: "Règlement", other: "Autre pièce", reply: "Pièce jointe" } as const;

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_FILES = "application/pdf,image/*,.doc,.docx,.odt";

export interface PublicCategory {
  slug: string;
  label: string;
  kind: "rassemblement" | "tournoi";
}

export interface PublicFormConfig {
  categories: PublicCategory[];
  minNoticeDays: number;
  introText: string | null;
}

export interface ClubHit {
  clubNumber: string;
  clubName: string;
  city: string | null;
  districtCode: string | null;
  districtName: string | null;
}

const optText = (max = 2000) => z.string().trim().max(max).optional().default("");
const optBool = z.boolean().nullable().optional().default(null);
const optInt = (max = 100000) => z.number().int().min(0).max(max).nullable().optional().default(null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");
const time = z
  .string()
  .regex(/^(\d{2}:\d{2})?$/, "Heure invalide.")
  .optional()
  .default("");

export const categorySchema = z.object({
  slug: z.string().max(40),
  teams: optInt(500),
  playDate: z.union([date, z.literal("")]).optional().default(""),
  playersPerTeam: optInt(30),
  substitutes: optInt(30),
  surface: optText(60),
  format: z.enum(["poules", "elimination", "poules_elimination", "plateau"]).nullable().optional().default(null),
  matchMinutes: optInt(200),
  matchesPerTeam: optInt(100),
  minPlayMinutes: optInt(1000),
  maxPlayMinutes: optInt(1000),
});

export const fileMetaSchema = z.object({
  kind: z.enum(["poster", "rules", "other"]),
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().max(120),
  size: z.number().int().min(1).max(MAX_FILE_BYTES, "Fichier trop lourd (20 Mo maximum)."),
});

export const declarationSchema = z
  .object({
    club: z.object({ clubNumber: z.string().trim().max(20).nullable(), clubName: z.string().trim().min(2, "Indiquez votre club.").max(160) }),
    districtCode: z.string().max(10).nullable().optional().default(null),
    title: z.string().trim().min(3, "Donnez un nom à la manifestation.").max(160),
    startDate: date,
    endDate: date,
    startTime: time,
    endTime: time,
    address: z.string().trim().min(5, "Indiquez l'adresse.").max(300),
    contactFirstName: z.string().trim().min(1, "Prénom du responsable obligatoire.").max(80),
    contactLastName: z.string().trim().min(1, "Nom du responsable obligatoire.").max(80),
    contactPhone: z.string().trim().min(6, "Portable du responsable obligatoire.").max(30),
    contactLandline: optText(30),
    contactEmail: z.string().trim().toLowerCase().email("Adresse e-mail du responsable invalide."),
    categories: z.array(categorySchema).min(1, "Cochez au moins une catégorie.").max(12),
    clubsExpected: optInt(1000),
    otherDistricts: optBool,
    otherCountries: optBool,
    participantCharter: optBool,
    educationalMessages: optText(1000),
    matchSheetsAtStart: optBool,
    disciplineCommission: optBool,
    refreshments: optBool,
    catering: z.enum(["internal", "external", "none"]).nullable().optional().default(null),
    hotPoints: optBool,
    parking: optText(300),
    firstAid: optText(300),
    spectatorsExpected: optInt(100000),
    animations: optText(2000),
    otherInfo: optText(3000),
    usesLeagueSoftware: z.boolean().optional().default(false),
    files: z.array(fileMetaSchema).max(6).default([]),
    certify: z.literal(true, { message: "Merci de certifier l'exactitude des informations." }),
    website: z.string().optional().default(""), // champ piège (robots)
  })
  .refine((d) => d.endDate >= d.startDate, { message: "La date de fin précède la date de début.", path: ["endDate"] })
  .superRefine((d, ctx) => {
    const e = d.usesLeagueSoftware ? softwareMissing(d) : null;
    if (e) ctx.addIssue({ code: "custom", message: e, path: ["usesLeagueSoftware"] });
  });

/**
 * Logiciel de gestion de tournoi offert par la ligue : les informations complémentaires deviennent
 * obligatoires (ainsi que la durée d'un match et le nombre de matchs par équipe). Message du premier
 * manque, sinon null. Partagé par le formulaire et le serveur.
 */
export function softwareMissing(d: {
  categories: { teams?: number | null; playersPerTeam?: number | null; matchMinutes?: number | null; matchesPerTeam?: number | null }[];
  clubsExpected?: number | null;
  otherDistricts?: boolean | null;
  otherCountries?: boolean | null;
  participantCharter?: boolean | null;
  matchSheetsAtStart?: boolean | null;
  disciplineCommission?: boolean | null;
  refreshments?: boolean | null;
  catering?: string | null;
  hotPoints?: boolean | null;
  parking?: string | null;
  firstAid?: string | null;
  spectatorsExpected?: number | null;
}): string | null {
  if (d.categories.some((c) => c.teams == null || c.playersPerTeam == null || c.matchMinutes == null || c.matchesPerTeam == null))
    return "Logiciel de la ligue : pour chaque catégorie, indiquez le nombre d'équipes, les joueurs par équipe, la durée d'un match et le nombre de matchs par équipe.";
  const missing = [
    d.clubsExpected == null && "nombre de clubs attendus",
    d.otherDistricts == null && "équipes d'autres districts",
    d.otherCountries == null && "équipes d'autres pays",
    d.participantCharter == null && "charte des participants",
    d.matchSheetsAtStart == null && "feuilles de match",
    d.disciplineCommission == null && "commission de discipline",
    d.refreshments == null && "buvette",
    !d.catering && "pôle restauration",
    d.hotPoints == null && "points chauds",
    !d.parking?.trim() && "parkings",
    !d.firstAid?.trim() && "secours",
    d.spectatorsExpected == null && "spectateurs prévus",
  ].filter(Boolean);
  return missing.length ? `Logiciel de la ligue : merci de compléter ${missing.join(", ")}.` : null;
}

export type DeclarationInput = z.input<typeof declarationSchema>;
export type CategoryInput = z.input<typeof categorySchema>;

export const replySchema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  message: z.string().trim().min(2, "Écrivez votre message.").max(8000),
  files: z
    .array(z.object({ name: z.string().trim().min(1).max(200), mimeType: z.string().max(120), size: z.number().int().min(1).max(MAX_FILE_BYTES, "Fichier trop lourd (20 Mo maximum).") }))
    .max(5)
    .default([]),
  website: z.string().optional().default(""),
});
export type ReplyInput = z.input<typeof replySchema>;

/** Jours entre aujourd'hui (Paris) et la date du tournoi. */
export function daysUntil(isoDate: string, from = new Date()) {
  const today = new Date(from.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }) + "T00:00:00Z");
  return Math.round((new Date(isoDate + "T00:00:00Z").getTime() - today.getTime()) / 86_400_000);
}

export function fmtDay(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

export function fmtPeriod(start: string, end: string) {
  return start === end ? fmtDay(start) : `du ${fmtDay(start)} au ${fmtDay(end)}`;
}

export function fmtHours(start: string | null, end: string | null) {
  const s = start?.slice(0, 5);
  const e = end?.slice(0, 5);
  if (s && e) return `${s.replace(":", "h")} – ${e.replace(":", "h")}`;
  return s ? `à partir de ${s.replace(":", "h")}` : e ? `jusqu'à ${e.replace(":", "h")}` : "";
}

export const yesNo = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Oui" : "Non");

export function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
