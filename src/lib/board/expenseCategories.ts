// Catégories d'une ligne de frais : chacune correspond à une colonne montant de event_expenses
// (schéma partagé avec l'appli calendrier). Une ligne saisie ici n'a qu'une catégorie ; les
// anciennes lignes peuvent en cumuler plusieurs.

export const EXPENSE_CATEGORIES = ["transport", "fuel", "toll", "parking", "car_rental", "hotel", "meal", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseAmountColumn =
  | "transport_fees"
  | "fuel_fees"
  | "toll_fees"
  | "parking_fees"
  | "car_rental_fees"
  | "hotel_fees"
  | "meal_fees"
  | "other_fees";

export const CATEGORY_META: Record<ExpenseCategory, { label: string; column: ExpenseAmountColumn }> = {
  transport: { label: "Transport (train, avion…)", column: "transport_fees" },
  fuel: { label: "Carburant", column: "fuel_fees" },
  toll: { label: "Péage", column: "toll_fees" },
  parking: { label: "Parking", column: "parking_fees" },
  car_rental: { label: "Location de véhicule", column: "car_rental_fees" },
  hotel: { label: "Hôtel", column: "hotel_fees" },
  meal: { label: "Repas", column: "meal_fees" },
  other: { label: "Autre", column: "other_fees" },
};

/** Montants non nuls d'une ligne, par catégorie (pour l'affichage). */
export function lineParts(line: Partial<Record<ExpenseAmountColumn, number | null>>): { category: ExpenseCategory; label: string; amount: number }[] {
  return EXPENSE_CATEGORIES.map((c) => ({ category: c, label: CATEGORY_META[c].label, amount: Number(line[CATEGORY_META[c].column] ?? 0) })).filter(
    (p) => p.amount > 0
  );
}

/** Frais d'un événement, ou frais hors événement d'un mois ('YYYY-MM'). */
export type ExpenseTarget = { eventId: string } | { month: string };

export const targetKey = (t: ExpenseTarget) => ("eventId" in t ? `event:${t.eventId}` : `month:${t.month}`);

export const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
