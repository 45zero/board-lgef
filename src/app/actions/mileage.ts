"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { travelToEvent } from "@/lib/board/travel";
import { MILEAGE_BLOCK_LABELS, mileageAmount, mileageBlock } from "@/lib/board/mileage";
import { KM_RATE } from "@/lib/board/staff";

/**
 * Ligne « Indemnités kilométriques » proposée sur un événement : domicile (profil) → lieu de
 * l'événement, aller-retour, à KM_RATE €/km. Rien n'est enregistré ici : la personne valide la
 * proposition (ou corrige les kilomètres) et la ligne passe par addExpenseLines, qui revérifie le
 * droit et recalcule le montant.
 */
export type MileageSuggestion =
  | { status: "ok"; km: number; amount: number; rate: number; from: string; to: string; date: string | null }
  /** Pas de droit (véhicule de fonction, prestataire, bénévole) : `message` dit pourquoi. */
  | { status: "blocked"; message: string }
  /** Adresse du domicile manquante : à renseigner dans Mon profil. */
  | { status: "no_address"; rate: number }
  /** Lieu inconnu, réunion en ligne ou trajet introuvable : kilomètres à saisir à la main. */
  | { status: "no_route"; rate: number; date: string | null }
  /** Une ligne kilométrique existe déjà sur cet événement. */
  | { status: "already" }
  /** Indisponible (colonne pas encore créée, erreur) : rien à afficher. */
  | { status: "unavailable" };

export async function getMileageSuggestion(eventId: string): Promise<MileageSuggestion> {
  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return { status: "unavailable" };
    const service = createServiceClient();

    const block = await mileageBlock(service, userId);
    if (block) return { status: "blocked", message: MILEAGE_BLOCK_LABELS[block] };

    const [{ data: existing, error: existingError }, { data: ev }, { data: profile }] = await Promise.all([
      service.from("event_expenses").select("id").eq("user_id", userId).eq("event_id", eventId).gt("mileage_fees", 0).limit(1),
      service.from("events").select("start_date, location, event_address, online_meeting").eq("id", eventId).maybeSingle(),
      service.from("profiles").select("home_address, home_coordinates").eq("id", userId).maybeSingle(),
    ]);
    if (existingError || !ev) return { status: "unavailable" };
    if ((existing ?? []).length) return { status: "already" };
    const date = ev.start_date ? ev.start_date.slice(0, 10) : null;
    if (!profile?.home_address && !profile?.home_coordinates) return { status: "no_address", rate: KM_RATE };
    const to = ev.location || ev.event_address || "";
    if (ev.online_meeting || !to) return { status: "no_route", rate: KM_RATE, date };

    const travel = (await travelToEvent(service, eventId, [userId]))[userId];
    if (!travel || !(travel.km > 0)) return { status: "no_route", rate: KM_RATE, date };
    const km = Math.round(travel.km * 2 * 10) / 10;
    return { status: "ok", km, amount: mileageAmount(km), rate: KM_RATE, from: profile.home_address ?? "Domicile", to, date };
  } catch (e) {
    console.error("[getMileageSuggestion]", e);
    return { status: "unavailable" };
  }
}
