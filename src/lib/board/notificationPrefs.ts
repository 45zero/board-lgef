import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Préférences de notification du module Frais (profiles.notification_prefs,
// sql/2026-11-05_notification_prefs.sql), réglées par chacun dans Paramètres → Notifications.
// Elles ne décident que du dérangement (push, e-mail) : la notification du board est toujours créée.

export type FraisCategory = "frais_decision" | "frais_refus" | "frais_a_valider";
export type FraisPrefValue = "instant" | "half_day" | "board";
export type NotificationPrefs = Partial<Record<FraisCategory, FraisPrefValue>> & { frais_a_valider_last_push?: string };

/** Choix proposés dans les Paramètres (le premier est la valeur par défaut, comportement d'avant). */
export const FRAIS_PREF_OPTIONS: Record<FraisCategory, { value: FraisPrefValue; label: string }[]> = {
  frais_decision: [
    { value: "instant", label: "Tout de suite" },
    { value: "board", label: "Dans le board seulement" },
  ],
  frais_refus: [
    { value: "instant", label: "Tout de suite" },
    { value: "board", label: "Dans le board seulement" },
  ],
  frais_a_valider: [
    { value: "instant", label: "À chaque fois" },
    { value: "half_day", label: "Au plus toutes les 12 h" },
    { value: "board", label: "Dans le board seulement" },
  ],
};

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * Faut-il déranger (push, e-mail) cette personne pour une notification de cette catégorie ?
 * « Au plus toutes les 12 h » : oui si le dernier rappel date de plus de 12 h — et on note celui-ci.
 */
export async function shouldAlert(service: SupabaseClient<Database>, userId: string, category: FraisCategory): Promise<boolean> {
  const { data } = await service.from("profiles").select("notification_prefs").eq("id", userId).maybeSingle();
  const prefs = (data?.notification_prefs ?? {}) as NotificationPrefs;
  const choice = prefs[category] ?? "instant";
  if (choice === "board") return false;
  if (choice === "instant" || category !== "frais_a_valider") return true;
  const last = prefs.frais_a_valider_last_push ? new Date(prefs.frais_a_valider_last_push).getTime() : 0;
  if (Date.now() - last < HALF_DAY_MS) return false;
  await service
    .from("profiles")
    .update({ notification_prefs: { ...prefs, frais_a_valider_last_push: new Date().toISOString() } })
    .eq("id", userId);
  return true;
}
