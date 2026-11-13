// FIEF — Femmes Investies dans l'Environnement du Football (fief.lgef.fr).
// Règles partagées client / serveur, sans dépendance : âge, mineures, adresses.
// Base : sql/2026-11-13_fief_cloison.sql (cloison avec le board) et sql/2026-11-13_fief_membres.sql.

export interface FiefSettings {
  minorsAllowed: boolean;
  minAge: number;
  parentalConsentUnder: number;
  charterText: string | null;
}

export interface FiefFunction {
  slug: string;
  label: string;
}

export interface FiefClub {
  clubNumber: string;
  clubName: string;
  city: string | null;
}

/**
 * Adresse publique de FIEF (liens des e-mails) : NEXT_PUBLIC_FIEF_URL (https://fief.lgef.fr une fois
 * le domaine pointé), sinon /fief sur le domaine du board.
 */
export const fiefUrl = (path = "") => {
  const base = process.env.NEXT_PUBLIC_FIEF_URL || `${(process.env.NEXT_PUBLIC_SITE_URL || "https://board-lgef.vercel.app").replace(/\/+$/, "")}/fief`;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") || !path ? path : `/${path}`}`;
};

/** Âge révolu à une date donnée (date de naissance au format AAAA-MM-JJ). */
export function ageOn(birthDate: string, on = new Date()) {
  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  let age = on.getFullYear() - y;
  if (on.getMonth() + 1 < m || (on.getMonth() + 1 === m && on.getDate() < d)) age -= 1;
  return age;
}

export type Eligibility = { ok: true; needsParent: boolean } | { ok: false; reason: string };

/** Peut-on s'inscrire à cet âge, et faut-il l'accord d'un parent ? (réglages de l'équipe FIEF) */
export function eligibility(birthDate: string, s: Pick<FiefSettings, "minorsAllowed" | "minAge" | "parentalConsentUnder">): Eligibility {
  const age = ageOn(birthDate);
  if (!Number.isFinite(age) || age < 5 || age > 110) return { ok: false, reason: "Date de naissance invalide." };
  if (age >= 18) return { ok: true, needsParent: false };
  if (!s.minorsAllowed) return { ok: false, reason: "FIEF est réservé aux personnes majeures." };
  if (age < s.minAge) return { ok: false, reason: `FIEF est ouvert à partir de ${s.minAge} ans.` };
  return { ok: true, needsParent: age < s.parentalConsentUnder };
}

export const DEFAULT_CHARTER =
  "FIEF est un espace d'entraide et de partage entre femmes engagées dans le football du Grand Est. " +
  "Je m'engage à rester bienveillante et respectueuse, à ne publier que des contenus dont j'ai les droits, " +
  "à ne pas diffuser à l'extérieur les informations personnelles des autres membres, et j'accepte que " +
  "l'équipe FIEF de la Ligue modère les échanges.";
