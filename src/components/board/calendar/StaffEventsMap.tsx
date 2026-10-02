"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Car, Loader2 } from "lucide-react";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { getEventPositions, getStaffLocations, getTravelToEvent } from "@/app/actions/map";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import {
  formatTravel,
  GRAND_EST_BOUNDS,
  STAFF_KINDS,
  STAFF_STYLES,
  type LatLng,
  type StaffKind,
  type StaffPin,
  type Travel,
} from "@/lib/board/geo";

export type MapEvent = { id: string; title: string; org: OrgKey; start?: string | null; location?: string | null };

// Positions déjà résolues, partagées entre les cartes de la session.
const positionCache = new Map<string, LatLng | null>();
let staffPromise: Promise<StaffPin[]> | null = null;

function eventIcon(color: string, selected: boolean): google.maps.Icon {
  const s = selected ? 30 : 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 30 30">${
    selected ? `<circle cx="15" cy="15" r="14" fill="${color}" fill-opacity="0.25"/>` : ""
  }<circle cx="15" cy="15" r="${selected ? 9.5 : 11}" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(s, s),
    anchor: new google.maps.Point(s / 2, s / 2),
  };
}

/** « Giovanni Verna » → « GV » ; un seul mot → ses deux premières lettres. */
function initials(name: string) {
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}

function staffIcon(p: StaffPin): google.maps.Icon {
  const { color } = STAFF_STYLES[p.kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect x="1.5" y="1.5" width="25" height="25" rx="7" fill="${color}" stroke="#fff" stroke-width="2.5"/><text x="14" y="18.3" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#fff">${esc(initials(p.name))}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
}

/** Trajets domicile → événement (aller simple) des utilisateurs donnés, ou de tous les techniciens. */
export function useTravelToEvent(eventId: string | null | undefined, userIds?: string[]) {
  // Résultat étiqueté par sa requête : un changement d'événement n'affiche jamais les trajets du précédent.
  const [result, setResult] = useState<{ key: string; travel: Record<string, Travel> } | null>(null);
  const key = `${eventId ?? ""}|${userIds?.join(",") ?? "*"}`;
  useEffect(() => {
    if (!eventId || (userIds && userIds.length === 0)) return;
    let cancelled = false;
    getTravelToEvent(eventId, userIds)
      .then((travel) => !cancelled && setResult({ key, travel }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key résume eventId et userIds
  }, [key]);
  return result?.key === key ? result.travel : NO_TRAVEL;
}

const NO_TRAVEL: Record<string, Travel> = {};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Carte Google du Grand Est : événements (pastilles aux couleurs de leur organisation) et, pour les
 * profils qui attribuent les captations, techniciens salariés / prestataires / bénévoles à leur domicile.
 * Un clic sur un technicien affiche ses kilomètres et son temps de route jusqu'à l'événement sélectionné.
 */
export function StaffEventsMap({
  events: eventsProp,
  focusEventId = null,
  onOpenEvent,
  sidebar = false,
  className = "h-full",
}: {
  events: MapEvent[];
  /** Panneau à droite : liste des événements de la période et techniciens au plus près (vue Carte du planning). */
  sidebar?: boolean;
  /** Événement sélectionné d'emblée (fiche événement, demande de captation). */
  focusEventId?: string | null;
  onOpenEvent?: (eventId: string) => void;
  className?: string;
}) {
  // Liste souvent recréée à chaque rendu du parent : on ne redessine les marqueurs que si son contenu change.
  const eventsSig = JSON.stringify(eventsProp.map((e) => [e.id, e.org, e.title, e.start, e.location]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- eventsSig résume eventsProp
  const events = useMemo(() => eventsProp, [eventsSig]);
  const loaded = useGoogleMapsScript();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const eventMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const selectedIdRef = useRef<string | null>(focusEventId);
  const onOpenEventRef = useRef(onOpenEvent);
  useEffect(() => {
    onOpenEventRef.current = onOpenEvent;
  }, [onOpenEvent]);
  const staffMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const openStaffRef = useRef<string | null>(null);

  const [staff, setStaff] = useState<StaffPin[]>([]);
  const [hiddenKinds, setHiddenKinds] = useState<Set<StaffKind>>(() => new Set());

  // Sélection : suit l'événement mis en avant par le parent, modifiable par un clic sur la carte.
  const [selectedId, setSelectedId] = useState<string | null>(focusEventId);
  const [prevFocus, setPrevFocus] = useState(focusEventId);
  if (prevFocus !== focusEventId) {
    setPrevFocus(focusEventId);
    setSelectedId(focusEventId);
  }

  // Positions : lues dans le cache de session ; les manquantes sont demandées au serveur.
  const [cacheVersion, setCacheVersion] = useState(0);
  const eventIdsKey = events.map((e) => e.id).join(",");
  const positions = useMemo(() => {
    const out: Record<string, LatLng> = {};
    for (const e of events) {
      const p = positionCache.get(e.id);
      if (p) out[e.id] = p;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheVersion signale un cache complété
  }, [events, cacheVersion]);
  const loadingPositions = events.some((e) => !positionCache.has(e.id));
  useEffect(() => {
    const missing = eventIdsKey.split(",").filter((id) => id && !positionCache.has(id));
    if (missing.length === 0) return;
    getEventPositions(missing)
      .then((res) => {
        for (const id of missing) positionCache.set(id, res[id] ?? null);
      })
      .catch(() => {
        for (const id of missing) positionCache.set(id, null);
      })
      .finally(() => setCacheVersion((v) => v + 1));
  }, [eventIdsKey]);

  useEffect(() => {
    staffPromise ??= getStaffLocations().catch(() => []);
    let cancelled = false;
    staffPromise.then((s) => !cancelled && setStaff(s));
    return () => {
      cancelled = true;
    };
  }, []);

  // Trajets de tous les techniciens vers l'événement sélectionné.
  const [travelResult, setTravelResult] = useState<{ eventId: string; travel: Record<string, Travel> } | null>(null);
  const wantsTravel = !!selectedId && staff.length > 0;
  useEffect(() => {
    if (!selectedId || !wantsTravel) return;
    let cancelled = false;
    getTravelToEvent(selectedId)
      .catch(() => ({}) as Record<string, Travel>)
      .then((travel) => !cancelled && setTravelResult({ eventId: selectedId, travel }));
    return () => {
      cancelled = true;
    };
  }, [selectedId, wantsTravel]);
  const travel = travelResult && travelResult.eventId === selectedId ? travelResult.travel : NO_TRAVEL;
  const travelLoading = wantsTravel && travelResult?.eventId !== selectedId;

  const selectedEvent = events.find((e) => e.id === selectedId) ?? null;

  // Carte, créée une fois.
  useEffect(() => {
    if (!loaded || !mapDivRef.current || mapRef.current) return;
    mapRef.current = new google.maps.Map(mapDivRef.current, {
      center: { lat: 48.7, lng: 5.8 },
      zoom: 7,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
    mapRef.current.fitBounds(GRAND_EST_BOUNDS, 8);
    infoRef.current = new google.maps.InfoWindow();
    infoRef.current.addListener("closeclick", () => (openStaffRef.current = null));
  }, [loaded]);

  // Recadre sur l'événement mis en avant dès que sa position est connue.
  const focusPos = focusEventId ? positions[focusEventId] : undefined;
  useEffect(() => {
    if (!mapRef.current || !focusPos) return;
    mapRef.current.setCenter(focusPos);
    mapRef.current.setZoom(9);
  }, [loaded, focusPos]);

  const staffInfoHtml = (p: StaffPin) => {
    const st = STAFF_STYLES[p.kind];
    const t = travel[p.id];
    const route = !selectedEvent
      ? `<div style="color:#6b7280">Cliquez un événement pour voir le trajet.</div>`
      : t
        ? `<div style="font-weight:700;color:#111827">🚗 ${esc(formatTravel(t))}</div><div style="color:#6b7280">jusqu'à ${esc(selectedEvent.title)} (aller simple)</div>`
        : `<div style="color:#6b7280">${travelLoading ? "Calcul du trajet…" : "Trajet indisponible (adresse manquante)."}</div>`;
    return `<div style="font:12px system-ui,sans-serif;min-width:180px"><div style="font-weight:700;font-size:13px">${esc(p.name)}</div><div style="color:${st.color};font-weight:600;margin-bottom:4px">${st.label}</div>${route}</div>`;
  };

  // Marqueurs d'événements.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    eventMarkersRef.current.forEach((m) => m.setMap(null));
    eventMarkersRef.current = new Map(
      events
      .filter((e) => positions[e.id])
      .map((e) => {
        const color = ORG_COLORS[e.org].base;
        const marker = new google.maps.Marker({
          map,
          position: positions[e.id],
          icon: eventIcon(color, e.id === selectedIdRef.current),
          title: e.title,
          zIndex: e.id === selectedIdRef.current ? 1000 : 10,
        });
        marker.addListener("click", () => {
          setSelectedId(e.id);
          const div = document.createElement("div");
          div.style.cssText = "font:12px system-ui,sans-serif;min-width:190px;max-width:260px";
          div.innerHTML = `<div style="font-weight:700;font-size:13px">${esc(e.title)}</div><div style="color:${color};font-weight:600">${esc(ORG_LABELS[e.org])}</div>${
            e.start ? `<div style="color:#374151;margin-top:2px">${esc(format(parseISO(e.start), "EEEE d MMMM · HH:mm", { locale: fr }))}</div>` : ""
          }${e.location ? `<div style="color:#6b7280">${esc(e.location)}</div>` : ""}`;
          if (onOpenEventRef.current) {
            const btn = document.createElement("button");
            btn.textContent = "Ouvrir l'événement →";
            btn.style.cssText = "margin-top:6px;color:#1d4ed8;font-weight:600;background:none;border:0;padding:0;cursor:pointer";
            btn.onclick = () => onOpenEventRef.current?.(e.id);
            div.appendChild(btn);
          }
          openStaffRef.current = null;
          infoRef.current?.setContent(div);
          infoRef.current?.open({ map, anchor: marker });
        });
        return [e.id, marker] as const;
      })
    );
  }, [loaded, events, positions]);

  // Sélection : seule l'icône change (recréer les marqueurs fermerait la bulle ouverte).
  useEffect(() => {
    selectedIdRef.current = selectedId;
    for (const [id, marker] of eventMarkersRef.current) {
      const e = events.find((x) => x.id === id);
      if (!e) continue;
      marker.setIcon(eventIcon(ORG_COLORS[e.org].base, id === selectedId));
      marker.setZIndex(id === selectedId ? 1000 : 10);
    }
  }, [selectedId, events, positions]);

  // Marqueurs des techniciens.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    staffMarkersRef.current.forEach((m) => m.setMap(null));
    staffMarkersRef.current = new Map();
    for (const p of staff) {
      if (hiddenKinds.has(p.kind)) continue;
      const marker = new google.maps.Marker({ map, position: p.position, icon: staffIcon(p), title: `${p.name} — ${STAFF_STYLES[p.kind].label}`, zIndex: 500 });
      marker.addListener("click", () => {
        openStaffRef.current = p.id;
        infoRef.current?.setContent(staffInfoHtml(p));
        infoRef.current?.open({ map, anchor: marker });
      });
      staffMarkersRef.current.set(p.id, marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staffInfoHtml lit travel, rafraîchi par l'effet suivant
  }, [loaded, staff, hiddenKinds]);

  // Trajet arrivé (ou événement changé) : la bulle ouverte d'un technicien se met à jour.
  useEffect(() => {
    const id = openStaffRef.current;
    const p = id ? staff.find((s) => s.id === id) : null;
    if (p) infoRef.current?.setContent(staffInfoHtml(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel, travelLoading, selectedId]);

  // Panneau latéral : tous les techniciens (ceux sans trajet calculable à la fin) ; encart flottant : les 8 plus proches.
  const nearest = useMemo(() => {
    const shown = staff.filter((p) => !hiddenKinds.has(p.kind));
    const withRoute = shown.filter((p) => travel[p.id]).sort((a, b) => travel[a.id].minutes - travel[b.id].minutes);
    return sidebar ? [...withRoute, ...shown.filter((p) => !travel[p.id]).sort((a, b) => a.name.localeCompare(b.name))] : withRoute.slice(0, 8);
  }, [staff, travel, hiddenKinds, sidebar]);

  const focusStaff = (p: StaffPin) => {
    const marker = staffMarkersRef.current.get(p.id);
    if (!marker) return;
    mapRef.current?.panTo(p.position);
    google.maps.event.trigger(marker, "click");
  };

  /** Depuis la liste : sélectionne l'événement, centre la carte dessus et ouvre sa bulle. */
  const focusEvent = (id: string) => {
    const marker = eventMarkersRef.current.get(id);
    setSelectedId(id);
    if (!marker || !positions[id]) return;
    mapRef.current?.panTo(positions[id]);
    if ((mapRef.current?.getZoom() ?? 0) < 9) mapRef.current?.setZoom(9);
    google.maps.event.trigger(marker, "click");
  };

  // Événements par ordre chronologique, avec l'en-tête du jour sur le premier de chaque journée.
  const eventRows = useMemo(() => {
    const sorted = [...events].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
    return sorted.map((e, i) => {
      const day = e.start ? format(parseISO(e.start), "EEEE d MMMM", { locale: fr }) : "";
      const prev = i > 0 && sorted[i - 1].start ? format(parseISO(sorted[i - 1].start!), "EEEE d MMMM", { locale: fr }) : null;
      return { e, header: day && day !== prev ? day : null };
    });
  }, [events]);
  const withoutPlace = events.length - Object.keys(positions).length;

  const staffRows = (
    <>
      {travelLoading && (
        <div className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-ink-4">
          <Loader2 size={11} className="animate-spin" /> Calcul des trajets…
        </div>
      )}
      {!travelLoading && nearest.length === 0 && <div className="px-3 py-1.5 text-[11px] text-ink-4">Aucun technicien à afficher.</div>}
      {nearest.map((p) => (
        <button key={p.id} onClick={() => focusStaff(p)} className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-hover">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[8px] font-bold text-white" style={{ background: STAFF_STYLES[p.kind].color }}>
            {initials(p.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{p.name}</span>
          {travel[p.id] ? (
            <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-ink-3">
              <Car size={10} /> {formatTravel(travel[p.id])}
            </span>
          ) : (
            !travelLoading && <span className="shrink-0 text-[10px] text-ink-4">—</span>
          )}
        </button>
      ))}
    </>
  );

  const mapPane = (
    <div className={`relative overflow-hidden rounded-panel border border-line bg-subtle ${sidebar ? "min-h-[360px] flex-1" : className}`}>
      <div ref={mapDivRef} className="absolute inset-0" />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-4">
          <Loader2 size={16} className="mr-2 animate-spin" /> Chargement de la carte…
        </div>
      )}

      {/* Légende */}
      <div className="absolute bottom-2 left-2 z-[1] max-w-[calc(100%-1rem)] rounded-btn border border-line bg-card/95 px-2.5 py-2 text-[11px] shadow-card">
        {staff.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {STAFF_KINDS.map((k) => {
              const st = STAFF_STYLES[k];
              const off = hiddenKinds.has(k);
              const n = staff.filter((s) => s.kind === k).length;
              return (
                <button
                  key={k}
                  onClick={() =>
                    setHiddenKinds((prev) => {
                      const next = new Set(prev);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      return next;
                    })
                  }
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${off ? "border-line text-ink-4 opacity-60" : "border-line text-ink-2"}`}
                  title={off ? "Afficher" : "Masquer"}
                >
                  <span className="h-3 w-3 rounded-[3px]" style={{ background: st.color }} />
                  {st.label} ({n})
                </button>
              );
            })}
          </div>
        )}
        <div className={`${staff.length > 0 ? "mt-1" : ""} flex items-center gap-2 text-ink-4`}>
          {loadingPositions ? (
            <span className="flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Placement des événements…
            </span>
          ) : (
            <span>
              {Object.keys(positions).length} événement(s) sur la carte
              {withoutPlace > 0 && ` · ${withoutPlace} sans lieu`}
            </span>
          )}
        </div>
      </div>

      {/* Encart flottant (petites cartes) : techniciens les plus proches de l'événement sélectionné */}
      {!sidebar && selectedEvent && staff.length > 0 && (
        <div className="absolute right-2 top-2 z-[1] w-60 max-w-[calc(100%-1rem)] rounded-btn border border-line bg-card/95 shadow-card">
          <div className="border-b border-line px-3 py-2">
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-4">Au plus près de</div>
            <div className="truncate text-xs font-bold text-ink">{selectedEvent.title}</div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">{staffRows}</div>
        </div>
      )}
    </div>
  );

  if (!sidebar) return mapPane;

  // Grand écran : carte à gauche ; à droite les événements de la période puis les techniciens au plus près.
  return (
    <div className={`flex min-h-0 flex-col gap-3 lg:flex-row ${className}`}>
      {mapPane}
      <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-80">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="text-xs font-bold text-ink">Événements</div>
            <div className="font-mono text-[10px] text-ink-4">{events.length}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {events.length === 0 && <div className="px-3 py-2 text-[11px] text-ink-4">Aucun événement sur cette période.</div>}
            {eventRows.map(({ e, header }) => {
              const color = ORG_COLORS[e.org];
              const onMap = !!positions[e.id];
              const selected = e.id === selectedId;
              return (
                <div key={e.id}>
                  {header && <div className="px-3 pb-0.5 pt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-4">{header}</div>}
                  <button
                    onClick={() => focusEvent(e.id)}
                    className={`flex w-full items-start gap-2 border-l-2 px-3 py-1.5 text-left ${selected ? "bg-sel-bg" : "hover:bg-hover"}`}
                    style={{ borderLeftColor: selected ? color.base : "transparent" }}
                  >
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.base, opacity: onMap ? 1 : 0.35 }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink">{e.title}</span>
                      <span className="block truncate text-[10.5px] text-ink-4">
                        {e.start && format(parseISO(e.start), "HH:mm")}
                        {e.location ? ` · ${e.location}` : ""}
                        {!onMap && !loadingPositions && " · pas sur la carte"}
                      </span>
                    </span>
                    {onOpenEvent && selected && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpenEvent(e.id);
                        }}
                        className="shrink-0 self-center rounded-full border border-line px-1.5 py-px text-[10px] font-semibold text-link hover:border-link"
                      >
                        Ouvrir
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {staff.length > 0 && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
            <div className="border-b border-line px-3 py-2">
              <div className="text-xs font-bold text-ink">Au plus près</div>
              <div className="truncate text-[10.5px] text-ink-4">
                {selectedEvent ? `de ${selectedEvent.title} · aller simple en voiture` : "Sélectionnez un événement pour classer les techniciens"}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {selectedEvent ? staffRows : <div className="px-3 py-2 text-[11px] text-ink-4">Cliquez un événement dans la liste ou sur la carte.</div>}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
