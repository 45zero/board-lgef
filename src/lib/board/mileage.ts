import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { KM_RATE } from "@/lib/board/staff";

// Indemnités kilométriques (sql/2026-11-20_frais_kilometriques.sql) : KM_RATE €/km aller-retour pour
// les salariés, le comité directeur et la TeamMedias « Réseau » sans véhicule de fonction. Rien pour
// la TeamMedias bénévole ou prestataire, ni avec un véhicule de fonction. Règle unique, appliquée à
// la saisie (expenseLines.ts), à la proposition sur un événement (actions/mileage.ts) et à
// l'Effectif (staffCore.ts).

type Service = ReturnType<typeof createServiceClient>;

/** Pourquoi une personne n'a pas droit aux indemnités kilométriques (null : elle y a droit). */
export type MileageBlock = "company_car" | "prestataire" | "benevole";

export const MILEAGE_BLOCK_LABELS: Record<MileageBlock, string> = {
  company_car: "Véhicule de fonction (profil) : pas d'indemnités kilométriques.",
  prestataire: "TeamMedias prestataire : vos déplacements sont compris dans votre facture.",
  benevole: "TeamMedias bénévole : pas d'indemnités kilométriques.",
};

/** Personnes (parmi `userIds`) sans droit aux indemnités, avec la raison. */
export async function mileageBlocks(service: Service, userIds: string[]): Promise<Map<string, MileageBlock>> {
  const out = new Map<string, MileageBlock>();
  if (!userIds.length) return out;
  const [{ data: cars }, { data: links }] = await Promise.all([
    service.from("profiles").select("id").in("id", userIds).eq("has_company_car", true),
    service.from("profile_specialties").select("user_id, specialties!inner(slug)").in("specialties.slug", ["tech-prestataire", "tech-benevole"]).in("user_id", userIds),
  ]);
  for (const l of (links ?? []) as unknown as { user_id: string; specialties: { slug: string } | { slug: string }[] }[]) {
    const slugs = (Array.isArray(l.specialties) ? l.specialties : [l.specialties]).map((s) => s.slug);
    out.set(l.user_id, slugs.includes("tech-prestataire") ? "prestataire" : "benevole");
  }
  // Le statut prime : un prestataire reste payé au forfait, un bénévole sans indemnité, véhicule ou non.
  for (const c of cars ?? []) if (!out.has(c.id)) out.set(c.id, "company_car");
  return out;
}

export async function mileageBlock(service: Service, userId: string): Promise<MileageBlock | null> {
  return (await mileageBlocks(service, [userId])).get(userId) ?? null;
}

/** Montant en euros de `km` kilomètres (arrondi au centime). */
export const mileageAmount = (km: number) => Math.round(km * KM_RATE * 100) / 100;
