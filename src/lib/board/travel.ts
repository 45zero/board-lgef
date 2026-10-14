import "server-only";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { parseLatLng, type LatLng, type Travel } from "@/lib/board/geo";

// Trajets domicile → événement (Google Geocoding + Routes), partagés par la carte
// (src/app/actions/map.ts) et l'Effectif (indemnités kilométriques du réseau). Rien n'est réécrit en
// base : coordonnées et trajets vivent dans des caches mémoire (par instance serveur).
// `travel_distances` (ancien calendrier) est seulement lu — une ligne y déclenche les frais
// kilométriques, on ne la crée pas pour une simple consultation. Aucun contrôle de droits ici :
// à l'appelant de vérifier qui peut voir quoi.

const MAPS_KEY = () => process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

const geocodeCache = new Map<string, LatLng | null>();
const travelCache = new Map<string, { at: number; travel: Travel | null }>();
const TRAVEL_TTL = 12 * 3600_000;

export async function geocode(address: string): Promise<LatLng | null> {
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

export async function eventPosition(ev: { location: string | null; event_address: string | null; event_coordinates: unknown }) {
  const address = ev.location || ev.event_address;
  return parseLatLng(ev.event_coordinates) ?? (address ? await geocode(address) : null);
}

/** Trajet en voiture (aller simple) du domicile de chaque utilisateur vers l'événement. */
export async function travelToEvent(service: ReturnType<typeof createServiceClient>, eventId: string, ids: string[]): Promise<Record<string, Travel>> {
  if (ids.length === 0) return {};
  const { data: ev } = await service.from("events").select("id, location, event_address, event_coordinates, online_meeting").eq("id", eventId).maybeSingle();
  if (!ev || ev.online_meeting) return {};
  const destination = await eventPosition(ev);
  if (!destination) return {};
  const toAddress = ev.location || ev.event_address || "";

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

const routeCache = new Map<string, { at: number; route: RouteResult | null }>();

export type RouteResult = Travel & { from: LatLng; to: LatLng; path: LatLng[] };

/** Décode une polyligne encodée Google (précision 1e-5). */
function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Position du domicile d'un utilisateur (coordonnées enregistrées, sinon adresse géocodée). */
export async function homePosition(service: ReturnType<typeof createServiceClient>, userId: string) {
  const { data: p } = await service.from("profiles").select("home_address, home_coordinates").eq("id", userId).maybeSingle();
  if (!p) return null;
  const pos = parseLatLng(p.home_coordinates) ?? (p.home_address ? await geocode(p.home_address) : null);
  return pos ? { pos, address: p.home_address ?? "" } : null;
}

/** Itinéraire en voiture (aller simple) avec son tracé, pour la mini-carte de la fiche événement. */
export async function computeRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const cacheKey = `${from.lat},${from.lng}|${to.lat},${to.lng}`;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TRAVEL_TTL) return cached.route;
  if (!MAPS_KEY()) return null;
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": MAPS_KEY(),
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        languageCode: "fr-FR",
      }),
    });
    const json = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] };
    const r = json.routes?.[0];
    if (!r || r.distanceMeters == null) {
      if (!res.ok) console.error("[computeRoute]", json);
      // Erreur passagère : pas de mise en cache.
      if (res.ok) routeCache.set(cacheKey, { at: Date.now(), route: null });
      return null;
    }
    const route: RouteResult = {
      km: r.distanceMeters / 1000,
      minutes: parseInt(r.duration ?? "0", 10) / 60,
      from,
      to,
      path: r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [from, to],
    };
    routeCache.set(cacheKey, { at: Date.now(), route });
    return route;
  } catch (e) {
    console.error("[computeRoute]", e);
    return null;
  }
}

/** Temps de route du domicile d'un utilisateur vers plusieurs événements (une seule matrice 1 × N). */
export async function travelFromHome(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  events: { id: string; location: string | null; event_address: string | null; event_coordinates: unknown }[]
): Promise<Record<string, Travel>> {
  if (events.length === 0) return {};
  const home = await homePosition(service, userId);
  if (!home) return {};
  const out: Record<string, Travel> = {};
  const toCompute: { id: string; dest: LatLng; cacheKey: string }[] = [];
  for (const ev of events) {
    const cacheKey = `${userId}|${ev.id}|${home.address}|${ev.location || ev.event_address || ""}`;
    const cached = travelCache.get(cacheKey);
    if (cached && Date.now() - cached.at < TRAVEL_TTL) {
      if (cached.travel) out[ev.id] = cached.travel;
      continue;
    }
    const dest = await eventPosition(ev);
    if (dest) toCompute.push({ id: ev.id, dest, cacheKey });
  }
  if (toCompute.length === 0 || !MAPS_KEY()) return out;
  try {
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": MAPS_KEY(),
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: home.pos.lat, longitude: home.pos.lng } } } }],
        destinations: toCompute.map((c) => ({ waypoint: { location: { latLng: { latitude: c.dest.lat, longitude: c.dest.lng } } } })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    });
    const rows = (await res.json()) as { destinationIndex?: number; distanceMeters?: number; duration?: string; condition?: string }[];
    if (!Array.isArray(rows)) {
      console.error("[travelFromHome]", rows);
      return out;
    }
    for (const r of rows) {
      const c = toCompute[r.destinationIndex ?? 0];
      if (!c) continue;
      const travel =
        r.condition === "ROUTE_EXISTS" && r.distanceMeters != null ? { km: r.distanceMeters / 1000, minutes: parseInt(r.duration ?? "0", 10) / 60 } : null;
      travelCache.set(c.cacheKey, { at: Date.now(), travel });
      if (travel) out[c.id] = travel;
    }
  } catch (e) {
    console.error("[travelFromHome]", e);
  }
  return out;
}
