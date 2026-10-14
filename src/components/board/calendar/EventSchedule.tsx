"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, Car, Navigation } from "lucide-react";
import { getMyScheduleConflicts, type ScheduleConflict } from "@/app/actions/my-schedule";
import type { MyRoute } from "@/lib/board/travel";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { DEPARTURE_MARGIN_MIN, departureTime, formatTravel, type LatLng } from "@/lib/board/geo";

/** Bandeau « vous avez déjà un événement sur ce créneau » (événements où l'utilisateur est sollicité). */
export function ScheduleConflictWarning({
  startISO,
  endISO,
  excludeEventId,
}: {
  startISO: string | null;
  endISO: string | null;
  excludeEventId?: string | null;
}) {
  const key = `${startISO}|${endISO}|${excludeEventId ?? ""}`;
  const [result, setResult] = useState<{ key: string; conflicts: ScheduleConflict[] } | null>(null);
  useEffect(() => {
    if (!startISO || !endISO) return;
    let cancelled = false;
    // Petit délai : pas d'appel serveur à chaque frappe dans les champs d'heure.
    const t = setTimeout(() => {
      getMyScheduleConflicts(startISO, endISO, excludeEventId)
        .then((conflicts) => !cancelled && setResult({ key, conflicts }))
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key résume les paramètres
  }, [key]);
  const conflicts = result?.key === key ? result.conflicts : [];
  if (conflicts.length === 0) return null;

  return (
    <div role="alert" className="rounded-btn border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">
      <div className="flex items-center gap-1.5 font-bold">
        <AlertTriangle size={14} className="shrink-0" />
        Attention, vous avez déjà {conflicts.length > 1 ? `${conflicts.length} événements` : "un événement"} sur ce créneau
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-2">
        {conflicts.map((c) => (
          <li key={c.id}>
            <span className="font-semibold text-ink">{c.title}</span> — {format(parseISO(c.start), "EEE d MMM HH:mm", { locale: fr })} à{" "}
            {format(parseISO(c.end), "HH:mm")} <span className="text-ink-4">({c.roles.join(", ")})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Itinéraires déjà calculés (par adresse) : la fiche se rouvre sans attendre. Gardés aussi dans le
// navigateur 12 h pour survivre au rechargement de la page.
const ROUTE_TTL = 12 * 3600_000;
const ROUTE_STORE = "lgef:my-route:";
const routeMemo = new Map<string, MyRoute>();
const routeInflight = new Map<string, Promise<MyRoute>>();

function cachedRoute(address: string): MyRoute | null {
  const hit = routeMemo.get(address);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(ROUTE_STORE + address);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: MyRoute };
    if (Date.now() - at > ROUTE_TTL) return null;
    routeMemo.set(address, data);
    return data;
  } catch {
    return null;
  }
}

/** Itinéraire domicile → adresse (route GET : part en parallèle des server actions de la fiche). */
export function fetchMyRoute(address: string): Promise<MyRoute> {
  const hit = cachedRoute(address);
  if (hit) return Promise.resolve(hit);
  let p = routeInflight.get(address);
  if (!p) {
    p = fetch(`/api/my-route?address=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? (r.json() as Promise<MyRoute>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        // Adresse du profil manquante : pas mise en cache, elle peut être renseignée à tout moment.
        if (!("missing" in data && data.missing === "home")) {
          routeMemo.set(address, data);
          try {
            localStorage.setItem(ROUTE_STORE + address, JSON.stringify({ at: Date.now(), data }));
          } catch {}
        }
        return data;
      })
      .finally(() => routeInflight.delete(address));
    routeInflight.set(address, p);
  }
  return p;
}

/**
 * Sous le lieu : itinéraire en voiture depuis le domicile (adresse du profil), heure de départ conseillée
 * et petite carte du trajet.
 */
export function RoutePreview({ location, startISO, height = 180 }: { location: string; startISO: string | null; height?: number }) {
  const address = location.trim();
  // Script Google Maps chargé dès l'ouverture, en même temps que le calcul de l'itinéraire.
  useGoogleMapsScript();
  const [result, setResult] = useState<{ address: string; data: MyRoute } | null>(null);
  const firstRef = useRef(true);
  useEffect(() => {
    if (!address) return;
    if (cachedRoute(address)) {
      firstRef.current = false;
      return;
    }
    let cancelled = false;
    // Lieu de la fiche à l'ouverture : tout de suite. Lieu en cours de saisie : petit délai.
    const t = setTimeout(
      () => {
        fetchMyRoute(address)
          .then((data) => !cancelled && setResult({ address, data }))
          .catch(() => {});
      },
      firstRef.current ? 0 : 700
    );
    firstRef.current = false;
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [address]);

  if (!address) return null;
  // Itinéraire déjà connu : affiché dès le premier rendu.
  const data = result?.address === address ? result.data : cachedRoute(address);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

  if (!data) {
    // Même encombrement que la carte : rien ne saute quand l'itinéraire arrive.
    return (
      <div className="overflow-hidden rounded-btn border border-line">
        <div className="flex items-center gap-1.5 bg-subtle px-3 py-2 text-xs text-ink-4">
          <Car size={13} className="shrink-0" /> Calcul de l&rsquo;itinéraire…
        </div>
        <div style={{ height }} className="w-full animate-pulse bg-subtle" />
      </div>
    );
  }
  if ("missing" in data) {
    return (
      <div className="text-xs text-ink-4">
        {data.missing === "home"
          ? "Renseignez votre adresse dans votre profil pour voir l'itinéraire et l'heure de départ."
          : data.missing === "address"
            ? "Adresse introuvable — choisissez-la dans la liste de suggestions."
            : "Pas d'itinéraire en voiture vers cette adresse."}
      </div>
    );
  }

  const { route } = data;
  const departure = startISO ? departureTime(startISO, route.minutes) : null;
  return (
    <div className="overflow-hidden rounded-btn border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-subtle px-3 py-2 text-xs">
        <span className="flex flex-wrap items-center gap-1.5 text-ink-2">
          <Car size={13} className="shrink-0" />
          {departure && (
            <>
              Départ conseillé <span className="font-mono font-bold text-ink">{format(departure, "HH:mm")}</span> ·
            </>
          )}
          <span className="font-mono">{formatTravel(route)}</span> depuis votre domicile
          <span className="text-ink-4">(+{DEPARTURE_MARGIN_MIN} min de marge)</span>
        </span>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-link hover:underline">
          <Navigation size={12} /> Ouvrir dans Maps
        </a>
      </div>
      <RouteMap path={route.path} from={route.from} to={route.to} height={height} />
    </div>
  );
}

function RouteMap({ path, from, to, height }: { path: LatLng[]; from: LatLng; to: LatLng; height: number }) {
  const loaded = useGoogleMapsScript();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);

  useEffect(() => {
    if (!loaded || !divRef.current) return;
    mapRef.current ??= new google.maps.Map(divRef.current, {
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: "cooperative",
    });
    const map = mapRef.current;
    for (const o of overlaysRef.current) o.setMap(null);
    overlaysRef.current = [
      new google.maps.Polyline({ map, path, strokeColor: "#1D4ED8", strokeOpacity: 0.85, strokeWeight: 4 }),
      new google.maps.Marker({ map, position: from, label: { text: "D", color: "#fff", fontWeight: "700" }, title: "Domicile" }),
      new google.maps.Marker({ map, position: to, title: "Lieu de l'événement" }),
    ];
    const bounds = new google.maps.LatLngBounds();
    for (const p of path) bounds.extend(p);
    bounds.extend(from);
    bounds.extend(to);
    map.fitBounds(bounds, 24);
  }, [loaded, path, from, to]);

  useEffect(
    () => () => {
      for (const o of overlaysRef.current) o.setMap(null);
    },
    []
  );

  return <div ref={divRef} style={{ height }} className="w-full bg-subtle" />;
}
