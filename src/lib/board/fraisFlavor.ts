// Le module « frais » porte un nom selon le profil, même icône : Frais pour qui déclare des notes de
// frais (salariés, réseau, bénévoles), Factures pour les prestataires, GED pour les administrateurs
// et la compta (spécialité COMPTA_SLUG, « Accès comptabilité (GED) » dans la fiche utilisateur) :
// frais et factures de tout le monde, validation, paramètres.

import { isElevated } from "@/lib/board/modules";

export type FraisFlavor = "frais" | "factures" | "ged";

export const FRAIS_FLAVORS: Record<FraisFlavor, { label: string; kicker: string }> = {
  frais: { label: "Frais", kicker: "NOTES DE FRAIS" },
  factures: { label: "Factures", kicker: "MES FACTURES" },
  ged: { label: "GED", kicker: "FRAIS & FACTURES" },
};

export const COMPTA_SLUG = "access-ged";

export const fraisFlavorOf = (role: string, slugs: string[]): FraisFlavor =>
  isElevated(role) || slugs.includes(COMPTA_SLUG) ? "ged" : slugs.includes("tech-prestataire") ? "factures" : "frais";
