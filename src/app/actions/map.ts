"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { parseLatLng, STAFF_KINDS, STAFF_SPECIALTY, type LatLng, type StaffKind, type StaffPin, type Travel } from "@/lib/board/geo";

// Carte du Grand Est : positions des événements et des techniciens, trajets domicile → événement.
// Rien n'est réécrit en base : les coordonnées géocodées et les trajets calculés vivent dans des caches
// mémoire (par instance serveur). `travel_distances` (ancien calendrier) est seulement lu — une ligne y
// déclenche les frais kilométriques, on ne la crée pas pour une simple consultation de la carte.

const MAPS_KEY = () => process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const geocodeCache = new Map<string, LatLng | null>();
const travelCache = new Map<string, { at: number; travel: Travel | null }>();
const TRAVEL_TTL = 12 * 3600_000;

async function geocode(address: string): Promise<LatLng | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  const apiKey = MAPS_KEY();
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=fr&components=country:FR&language=fr&key=${apiKey}`
    );
    const json = (await res.json()) as { status: string; results?: { geometry: { location: LatLng } }[] };
    const loc = json.status === "OK" ? (json.results?.[0]?.geometry.location ?? null) : null;
    // Échec définitif (adresse introuvable) mis en cache ; erreur passagère (quota…) retentée plus tard.
    if (loc || json.status === "ZERO_RESULTS") geocodeCache.set(key, loc);
    return loc;
  } catch {
    return null;
  }
}

/** Utilisateur connecté + droit de voir les domiciles des techniciens (admins, super users, réseau salarié). */
async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  const [{ data: profile }, { data: specialty }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).single(),
    supabase
      .from("profile_specialties")
      .select("specialties!inner(slug)")
      .eq("user_id", user.id)
      .eq("specialties.slug", "tech-salarie")
      .maybeSingle(),
  ]);
  const canSeeStaff = profile?.role === "admin" || profile?.role === "super_user" || !!specialty;
  return { supabase, userId: user.id, canSeeStaff };
}

function displayName(p: { first_name: string | null; last_name: string | null; email: string | null }) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Utilisateur";
}

/**
 * Tous les techniciens (toute spécialité `tech-*`) et leur statut. Plusieurs statuts : le plus « interne »
 * l'emporte (salarié > prestataire > bénévole) ; aucun statut précisé : personnel de la Ligue (salarié).
 */
async function getStaffKinds(service: ReturnType<typeof createServiceClient>) {
  const { data: links } = await service.from("profile_specialties").select("user_id, specialties!inner(slug)").like("specialties.slug", "tech-%");
  const kindByUser = new Map<string, StaffKind | null>();
  for (const l of (links ?? []) as unknown as { user_id: string; specialties: { slug: string } }[]) {
    const kind = STAFF_SPECIALTY[l.specialties.slug] ?? null;
    const prev = kindByUser.get(l.user_id) ?? null;
    if (kind && (!prev || STAFF_KINDS.indexOf(kind) < STAFF_KINDS.indexOf(prev))) kindByUser.set(l.user_id, kind);
    else if (!kindByUser.has(l.user_id)) kindByUser.set(l.user_id, null);
  }
  return new Map([...kindByUser].map(([id, k]) => [id, k ?? "salarie"] as const));
}

/** Techniciens salariés, prestataires et bénévoles, placés à leur domicile. Vide pour les autres profils. */
export async function getStaffLocations(): Promise<StaffPin[]> {
  const { canSeeStaff } = await getViewer();
  if (!canSeeStaff) return [];
  const service = createServiceClient();
  const kindByUser = await getStaffKinds(service);
  if (kindByUser.size === 0) return [];
  const { data: profiles } = await service
    .from("profiles")
    .select("id, first_name, last_name, email, home_address, home_coordinates")
    .in("id", [...kindByUser.keys()]);
  const pins = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const position = parseLatLng(p.home_coordinates) ?? (p.home_address ? await geocode(p.home_address) : null);
      return position ? { id: p.id, name: displayName(p), kind: kindByUser.get(p.id)!, position } : null;
    })
  );
  return pins.filter((p): p is StaffPin => !!p);
}

async function eventPosition(ev: { location: string | null; event_address: string | null; event_coordinates: unknown }) {
  const address = ev.location || ev.event_address;
  return parseLatLng(ev.event_coordinates) ?? (address ? await geocode(address) : null);
}

/** Position de chaque événement (ceux que l'utilisateur peut lire — RLS) ; les événements sans lieu sont omis. */
export async function getEventPositions(eventIds: string[]): Promise<Record<string, LatLng>> {
  const ids = [...new Set(eventIds)].slice(0, 300);
  if (ids.length === 0) return {};
  const { supabase } = await getViewer();
  const { data } = await supabase.from("events").select("id, location, event_address, event_coordinates, online_meeting").in("id", ids);
  const out: Record<string, LatLng> = {};
  await Promise.all(
    (data ?? [])
      .filter((ev) => !ev.online_meeting)
      .map(async (ev) => {
        const pos = await eventPosition(ev);
        if (pos) out[ev.id] = pos;
      })
  );
  return out;
}

/**
 * Trajet en voiture (aller simple) du domicile de chaque utilisateur vers l'événement. Sans `userIds` :
 * tous les techniciens. Un utilisateur sans droit sur les techniciens n'obtient que son propre trajet.
 */
export async function getTravelToEvent(eventId: string, userIds?: string[]): Promise<Record<string, Travel>> {
  const { userId, canSeeStaff, supabase } = await getViewer();
  const { data: ev } = await supabase.from("events").select("id, location, event_address, event_coordinates, online_meeting").eq("id", eventId).maybeSingle();
  if (!ev || ev.online_meeting) return {};
  const destination = await eventPosition(ev);
  if (!destination) return {};
  const toAddress = ev.location || ev.event_address || "";

  const service = createServiceClient();
  let ids = userIds;
  if (!ids) {
    if (!canSeeStaff) return {};
    ids = [...(await getStaffKinds(service)).keys()];
  }
  if (!canSeeStaff) ids = ids.filter((id) => id === userId);
  ids = ids.slice(0, 100);
  if (ids.length === 0) return {};

  const [{ data: profiles }, { data: known }] = await Promise.all([
    service.from("profiles").select("id, home_address, home_coordinates").in("id", ids),
    service.from("travel_distances").select("user_id, from_address, to_address, distance_km, duration_minutes").eq("event_id", eventId).in("user_id", ids),
  ]);

  const out: Record<string, Travel> = {};
  const toCompute: { id: string; origin: LatLng; cacheKey: string }[] = [];
  for (const p of profiles ?? []) {
    if (!p.home_address && !p.home_coordinates) continue;
    const cacheKey = `${p.id}|${eventId}|${p.home_address ?? ""}|${toAddress}`;
    const cached = travelCache.get(cacheKey);
    if (cached && Date.now() - cached.at < TRAVEL_TTL) {
      if (cached.travel) out[p.id] = cached.travel;
      continue;
    }
    // Trajet déjà calculé pour les frais kilométriques (aller-retour) avec les mêmes adresses.
    const k = known?.find((t) => t.user_id === p.id && t.from_address === p.home_address && t.to_address === toAddress);
    if (k && k.duration_minutes) {
      out[p.id] = { km: k.distance_km / 2, minutes: k.duration_minutes / 2 };
      continue;
    }
    const origin = parseLatLng(p.home_coordinates) ?? (p.home_address ? await geocode(p.home_address) : null);
    if (origin) toCompute.push({ id: p.id, origin, cacheKey });
  }

  if (toCompute.length > 0 && MAPS_KEY()) {
    try {
      const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": MAPS_KEY(),
          "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition",
        },
        body: JSON.stringify({
          origins: toCompute.map((c) => ({ waypoint: { location: { latLng: { latitude: c.origin.lat, longitude: c.origin.lng } } } })),
          destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        }),
      });
      const rows = (await res.json()) as { originIndex?: number; distanceMeters?: number; duration?: string; condition?: string }[];
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const c = toCompute[r.originIndex ?? 0];
          if (!c) continue;
          const travel =
            r.condition === "ROUTE_EXISTS" && r.distanceMeters != null
              ? { km: r.distanceMeters / 1000, minutes: parseInt(r.duration ?? "0", 10) / 60 }
              : null;
          travelCache.set(c.cacheKey, { at: Date.now(), travel });
          if (travel) out[c.id] = travel;
        }
      } else {
        console.error("[getTravelToEvent]", rows);
      }
    } catch (e) {
      console.error("[getTravelToEvent]", e);
    }
  }
  return out;
}
