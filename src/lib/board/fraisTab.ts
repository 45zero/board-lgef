// Onglet du module Frais / Factures / GED à ouvrir au prochain affichage (tableau de bord → « Ouvrir »).

export type FraisTab = "invoices" | "mine" | "frais" | "factures" | "payables" | "settings";

let requested: FraisTab | null = null;

export function requestFraisTab(tab: FraisTab) {
  requested = tab;
}

/** Onglet demandé, une seule fois. */
export function takeFraisTab(): FraisTab | null {
  const tab = requested;
  requested = null;
  return tab;
}

/** Onglet de chaque action du tableau de bord. */
export const ACTION_FRAIS_TAB: Record<string, FraisTab> = {
  "frais-declarer": "mine",
  "frais-refuses": "mine",
  "frais-valider": "frais",
  "factures-deposer": "invoices",
  "factures-refusees": "invoices",
  "factures-valider": "factures",
  "a-payer": "payables",
};
