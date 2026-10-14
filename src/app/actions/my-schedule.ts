"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations, type SolicitationRole } from "@/lib/board/solicitation";
import { routeFromHome, travelFromHome, type MyRoute } from "@/lib/board/travel";
import { departureTime, type Travel } from "@/lib/board/geo";

export type { MyRoute };

// Agenda de l'utilisateur connecté, pour la fiche événement et la grille du calendrier :
// créneaux déjà pris (même règle « sollicité » que le calendrier), itinéraire depuis le domicile
// et temps de route vers les événements où il est sollicité. Rien n'est écrit en base.

async function currentUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { supabase, userId };
}

export type ScheduleConflict = { id: string; title: string; start: string; end: string; roles: SolicitationRole[] };

/**
 * Événements où l'utilisateur est sollicité (équipe, assigné, captation, photo, comité directeur confirmé)
 * qui chevauchent le créneau [startISO, endISO[. `excludeEventId` : l'événement en cours de modification.
 */
export async function getMyScheduleConflicts(startISO: string, endISO: string, excludeEventId?: string | null): Promise<ScheduleConflict[]> {
  const { userId } = await currentUserId();
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];

  const service = createServiceClient();
  const [roles, { data: overlapping }] = await Promise.all([
    getSolicitations(service, userId),
    service
      .from("events")
      .select("id, title, start_date, end_date, status, visibility")
      .lt("start_date", end.toISOString())
      .gt("end_date", start.toISOString())
      .limit(500),
  ]);
  return (overlapping ?? [])
    .filter((e) => e.id !== excludeEventId && roles.has(e.id) && e.status !== "rejected" && e.visibility !== "hidden")
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((e) => ({ id: e.id, title: e.title, start: e.start_date, end: e.end_date, roles: [...roles.get(e.id)!] }));
}

/** Itinéraire en voiture du domicile de l'utilisateur (adresse du profil) vers une adresse. */
export async function getMyRoute(address: string): Promise<MyRoute> {
  const { userId } = await currentUserId();
  return routeFromHome(userId, address);
}

/** Heure du rappel « au moment du départ » (début − trajet − marge), ou null sans itinéraire. */
export async function getMyDepartureAt(address: string, startISO: string): Promise<string | null> {
  const res = await getMyRoute(address);
  if (!("route" in res) || !Number.isFinite(new Date(startISO).getTime())) return null;
  return departureTime(startISO, res.route.minutes).toISOString();
}

/**
 * Temps de route domicile → événement pour les événements donnés où l'utilisateur est sollicité
 * (bloc « départ » en pointillé dans la grille). Les autres ids sont ignorés.
 */
export async function getMyTravelTimes(eventIds: string[]): Promise<Record<string, Travel>> {
  const ids = [...new Set(eventIds)].slice(0, 100);
  if (ids.length === 0) return {};
  const { supabase, userId } = await currentUserId();
  const service = createServiceClient();
  const [roles, { data: events }] = await Promise.all([
    getSolicitations(service, userId),
    // Lu avec la session : seulement des événements que l'utilisateur peut voir (RLS).
    supabase.from("events").select("id, location, event_address, event_coordinates, online_meeting").in("id", ids),
  ]);
  return travelFromHome(
    service,
    userId,
    (events ?? []).filter((e) => roles.has(e.id) && !e.online_meeting && (e.location || e.event_address || e.event_coordinates))
  );
}
