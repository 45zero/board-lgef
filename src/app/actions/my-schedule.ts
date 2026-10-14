"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getSolicitations, type SolicitationRole } from "@/lib/board/solicitation";
import { computeRoute, eventPosition, geocode, routeFromHome, travelFromHome, type MyRoute } from "@/lib/board/travel";
import { DEPARTURE_MARGIN_MIN, departureTime, type Travel } from "@/lib/board/geo";

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

/**
 * Conflit avec un événement où l'utilisateur est sollicité :
 * - overlap : les créneaux se chevauchent ;
 * - after : l'événement suit, mais le trajet depuis le lieu saisi (+ marge) ne laisse pas le temps d'y être ;
 * - before : l'événement précède, et le trajet depuis son lieu ne permet pas d'arriver à l'heure ;
 * - departure : sans lieu saisi, le créneau empiète sur le départ de chez soi vers l'événement suivant.
 */
export type ScheduleConflict = {
  id: string;
  title: string;
  start: string;
  end: string;
  roles: SolicitationRole[];
  kind: "overlap" | "after" | "before" | "departure";
  travel?: Travel;
  /** after : fin au plus tard ; before : début au plus tôt ; departure : heure de départ de chez soi. */
  limit?: string;
};

/** Trajets plus longs que ce délai : ignorés (fenêtre de recherche autour du créneau). */
const TRAVEL_WINDOW_MS = 6 * 3600_000;

/** Temps à prévoir entre deux lieux : trajet + marge, rien si c'est le même endroit. */
const neededMinutes = (t: Travel) => (t.minutes < 2 ? 0 : t.minutes + DEPARTURE_MARGIN_MIN);

/**
 * Événements où l'utilisateur est sollicité (équipe, assigné, captation, photo, comité directeur confirmé)
 * incompatibles avec le créneau [startISO, endISO[ : chevauchement, ou trajet impossible depuis / vers
 * le lieu saisi (`location`), ou départ de chez soi déjà entamé. `excludeEventId` : l'événement modifié.
 */
export async function getMyScheduleConflicts(
  startISO: string,
  endISO: string,
  excludeEventId?: string | null,
  location?: string | null
): Promise<ScheduleConflict[]> {
  const { userId } = await currentUserId();
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];

  const service = createServiceClient();
  const [roles, { data: nearby }, here] = await Promise.all([
    getSolicitations(service, userId),
    service
      .from("events")
      .select("id, title, start_date, end_date, status, visibility, location, event_address, event_coordinates, online_meeting")
      .lt("start_date", new Date(end.getTime() + TRAVEL_WINDOW_MS).toISOString())
      .gt("end_date", new Date(start.getTime() - TRAVEL_WINDOW_MS).toISOString())
      .limit(500),
    location?.trim() ? geocode(location.trim().slice(0, 300)) : Promise.resolve(null),
  ]);
  const mine = (nearby ?? []).filter((e) => e.id !== excludeEventId && roles.has(e.id) && e.status !== "rejected" && e.visibility !== "hidden");

  const checks = await Promise.all(
    mine.map(async (e): Promise<ScheduleConflict | null> => {
      const base = { id: e.id, title: e.title, start: e.start_date, end: e.end_date, roles: [...roles.get(e.id)!] };
      const eStart = new Date(e.start_date);
      const eEnd = new Date(e.end_date);
      if (eStart < end && eEnd > start) return { ...base, kind: "overlap" };
      const there = e.online_meeting ? null : await eventPosition(e);
      if (!there) return null;

      if (eStart >= end) {
        // L'événement suit : trajet depuis le lieu saisi, ou départ de chez soi sans lieu.
        if (here) {
          const route = await computeRoute(here, there);
          if (!route) return null;
          const latest = new Date(eStart.getTime() - neededMinutes(route) * 60_000);
          return end > latest ? { ...base, kind: "after", travel: { km: route.km, minutes: route.minutes }, limit: latest.toISOString() } : null;
        }
        const travel = (await travelFromHome(service, userId, [e]))[e.id];
        if (!travel) return null;
        const leave = departureTime(e.start_date, travel.minutes);
        return end > leave ? { ...base, kind: "departure", travel, limit: leave.toISOString() } : null;
      }

      // L'événement précède : trajet depuis son lieu jusqu'au lieu saisi.
      if (!here) return null;
      const route = await computeRoute(there, here);
      if (!route) return null;
      const earliest = new Date(eEnd.getTime() + neededMinutes(route) * 60_000);
      return start < earliest ? { ...base, kind: "before", travel: { km: route.km, minutes: route.minutes }, limit: earliest.toISOString() } : null;
    })
  );
  return checks.filter((c): c is ScheduleConflict => !!c).sort((a, b) => a.start.localeCompare(b.start));
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
