// Effectif (sql/2026-10-03_staff_costs.sql) : types et calculs partagés entre les actions
// (src/app/actions/staff.ts), le module Effectif, la fiche événement et le Week-end.

export type StaffStatus = "tech-salarie" | "tech-reseau" | "tech-prestataire" | "tech-benevole" | null;

export const STAFF_STATUS_LABELS: Record<NonNullable<StaffStatus>, string> = {
  "tech-salarie": "Salarié",
  "tech-reseau": "Réseau",
  "tech-prestataire": "Prestataire",
  "tech-benevole": "Bénévole",
};
export const STAFF_STATUSES = Object.keys(STAFF_STATUS_LABELS) as NonNullable<StaffStatus>[];

/** Pourquoi la personne est sollicitée sur l'événement. */
export type EngagementRole = "Équipe" | "Assigné" | "Captation" | "Photo";

/**
 * Une intervention : une personne sollicitée sur un événement. confirmed : engagement acquis
 * (membre de l'équipe, assigné, captation acceptée, match pris) ; sinon prévisionnel (captation
 * proposée, réponse attendue). amount : ajustement de l'événement, sinon forfait (prestataire) ou
 * kilomètres aller-retour × KM_RATE (réseau), sinon 0.
 */
export type Engagement = {
  userId: string;
  eventId: string;
  title: string;
  start: string;
  roles: EngagementRole[];
  confirmed: boolean;
  amount: number;
  adjusted: boolean;
  note: string | null;
  /** Réseau : kilomètres aller-retour domicile → événement (indemnités à KM_RATE), null sinon ou inconnus. */
  km: number | null;
};

/** Indemnité kilométrique du réseau, en euros par kilomètre. */
export const KM_RATE = 0.45;

export const formatKm = (km: number) => `${Math.round(km).toLocaleString("fr-FR")} km`;

export type StaffPerson = {
  id: string;
  name: string;
  email: string | null;
  status: StaffStatus;
  managerId: string | null;
  managerName: string | null;
  /** Forfait par intervention (euros), null si non renseigné. */
  rate: number | null;
};

export type StaffOverview = {
  viewer: { id: string; isAdmin: boolean; hasReports: boolean };
  year: number;
  people: StaffPerson[];
  /** Interventions de l'année, pour les personnes ci-dessus. */
  engagements: Engagement[];
};

/** Coût des prestataires (et de toute personne avec un forfait) sur un ensemble d'interventions. */
export function costTotals(engagements: Engagement[]) {
  let confirmed = 0;
  let pending = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  for (const e of engagements) {
    if (e.confirmed) {
      confirmed += e.amount;
      confirmedCount++;
    } else {
      pending += e.amount;
      pendingCount++;
    }
  }
  return { confirmed, pending, confirmedCount, pendingCount };
}

export const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 });

export const monthKey = (iso: string) => iso.slice(0, 7);
