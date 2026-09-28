"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { Download, Loader2, Mail, MapPin, MessageCircle, Navigation, Phone, Search, X } from "lucide-react";
import { useUserRole } from "@/hooks/board/useUserRole";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { listContactLists } from "@/app/actions/registration";
import { geocodeListBatch, listMapContacts } from "@/app/actions/cartography";
import { formatFrPhone, personName } from "@/lib/board/clubContacts";
import { GRAND_EST_BOUNDS } from "@/lib/board/geo";

type Directory = Awaited<ReturnType<typeof listContactLists>>[number];
type Contact = Awaited<ReturnType<typeof listMapContacts>>[number];

const NAVY = "#0b1d3c";
const GREY = "#94a3b8";
const RED = "#e11d48";

function dotIcon(color: string, selected: boolean): google.maps.Icon {
  const s = selected ? 26 : 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 26 26"><circle cx="13" cy="13" r="${selected ? 11 : 10}" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(s, s),
    anchor: new google.maps.Point(s / 2, s / 2),
  };
}

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function addressLine(c: Contact) {
  return [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function presidentName(c: Contact) {
  return personName({ first_name: c.first_name, last_name: c.last_name });
}

function extraFields(c: Contact) {
  return Object.entries((c.extra as Record<string, string> | null) ?? {}).filter(([, v]) => !!v);
}

/** Carte des clubs du Grand Est — fiches issues des annuaires (import Excel dans Inscription → Annuaires). */
export function CartographieScreen() {
  const role = useUserRole();
  const canAccess = role.isAdmin || role.isSuperUser || role.isTechSalarie;
  const mapsLoaded = useGoogleMapsScript();

  const [directories, setDirectories] = useState<Directory[]>([]);
  const [listId, setListId] = useState<string>("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState<{ remaining: number; error: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());

  // Annuaires ; par défaut celui des clubs.
  useEffect(() => {
    if (!canAccess) return;
    listContactLists().then((lists) => {
      setDirectories(lists);
      const clubs = lists.find((l) => /club/i.test(l.name)) ?? lists[0];
      if (clubs) setListId(clubs.id);
    });
  }, [canAccess]);

  // Fiches de l'annuaire choisi, puis localisation des adresses pas encore placées (par lots, stockée en base).
  useEffect(() => {
    if (!listId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSelectedId(null);
      const rows = await listMapContacts(listId);
      if (cancelled) return;
      setContacts(rows);
      setLoading(false);

      const hasPending = rows.some((c) => !c.geocoded_at && (c.address || c.postal_code || c.city));
      if (!hasPending) return;
      for (let round = 0; round < 100 && !cancelled; round++) {
        const { processed, remaining, error } = await geocodeListBatch(listId);
        if (cancelled) return;
        setGeocoding({ remaining, error });
        if (round % 5 === 4 || remaining === 0 || error || processed === 0) setContacts(await listMapContacts(listId));
        if (remaining === 0 || error || processed === 0) break;
      }
      if (!cancelled) setGeocoding((g) => (g?.error ? g : null));
    })();
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return contacts;
    return contacts.filter((c) =>
      normalize(
        [c.club, c.club_number, c.name, c.first_name, c.last_name, c.city, c.postal_code, c.email, c.email_secondary]
          .filter(Boolean)
          .join(" ")
      ).includes(q)
    );
  }, [contacts, query]);

  const located = filtered.filter((c) => c.lat != null && c.lng != null);
  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  // Carte, créée une fois.
  useEffect(() => {
    if (!mapsLoaded || !mapDivRef.current || mapRef.current) return;
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
    clustererRef.current = new MarkerClusterer({ map: mapRef.current, markers: [] });
  }, [mapsLoaded, canAccess]);

  // Points = fiches filtrées et localisées.
  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!mapsLoaded || !clusterer) return;
    clusterer.clearMarkers();
    markersRef.current.clear();
    const markers = located.map((c) => {
      const m = new google.maps.Marker({
        position: { lat: c.lat!, lng: c.lng! },
        title: c.club ?? c.name,
        icon: dotIcon(presidentName(c) ? NAVY : GREY, false),
      });
      m.addListener("click", () => setSelectedId(c.id));
      markersRef.current.set(c.id, m);
      return m;
    });
    clusterer.addMarkers(markers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `located` dérive de `filtered`
  }, [mapsLoaded, filtered]);

  // Point sélectionné mis en avant (hors regroupement) et centré.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || selected.lat == null || selected.lng == null) return;
    const highlight = new google.maps.Marker({
      map,
      position: { lat: selected.lat, lng: selected.lng },
      icon: dotIcon(RED, true),
      zIndex: 1000,
    });
    map.panTo({ lat: selected.lat, lng: selected.lng });
    if ((map.getZoom() ?? 0) < 11) map.setZoom(11);
    return () => highlight.setMap(null);
  }, [selected]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const extraKeys = [...new Set(filtered.flatMap((c) => extraFields(c).map(([k]) => k)))];
      const header = [
        "N° club",
        "Club",
        "Adresse",
        "Code postal",
        "Ville",
        "Civilité",
        "Prénom",
        "Nom",
        "Email club",
        "Email perso",
        "Mobile",
        ...extraKeys,
      ];
      const rows = filtered.map((c) => {
        const extra = (c.extra as Record<string, string> | null) ?? {};
        return [
          c.club_number,
          c.club,
          c.address,
          c.postal_code,
          c.city,
          c.civility,
          c.first_name,
          c.last_name,
          c.email,
          c.email_secondary,
          formatFrPhone(c.phone),
          ...extraKeys.map((k) => extra[k] ?? null),
        ].map((v) => (v ? { value: String(v) } : null));
      });
      const dir = directories.find((d) => d.id === listId)?.name ?? "annuaire";
      await writeXlsxFile([header.map((h) => ({ value: h, fontWeight: "bold" as const })), ...rows], {
        sheet: dir.slice(0, 31),
        columns: header.map((_, i) => ({ width: [9, 32, 32, 10, 20, 11, 16, 18, 30, 30, 15][i] ?? 22 })),
        stickyRowsCount: 1,
      }).toFile(`cartographie-${dir.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${query ? "-filtre" : ""}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  if (role.loading) return null;
  if (!canAccess) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ink-4">
        Réservé au réseau salarié et aux administrateurs.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      {/* Gauche — annuaire, recherche, liste */}
      <div className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-card">
        <div className="space-y-2 border-b border-line p-3">
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="w-full rounded-btn border border-line bg-card px-2.5 py-2 text-xs font-semibold text-ink outline-none"
          >
            {directories.length === 0 && <option value="">Aucun annuaire — importe un fichier dans Inscription</option>}
            {directories.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.memberCount})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-2">
            <Search size={13} className="shrink-0 text-ink-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Club, n°, ville, président, email…"
              className="w-full bg-transparent text-xs outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-ink-4 hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-ink-4">
            <span>
              {filtered.length} fiche(s) · {located.length} sur la carte
            </span>
            <button
              onClick={exportExcel}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-1 font-semibold text-link hover:underline disabled:opacity-50"
            >
              <Download size={11} /> {exporting ? "Export…" : "Exporter (.xlsx)"}
            </button>
          </div>
          {geocoding && (
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-3">
              {geocoding.error ? (
                <>Localisation interrompue ({geocoding.error}) — {geocoding.remaining} adresse(s) en attente.</>
              ) : (
                <>
                  <Loader2 size={11} className="animate-spin" /> Localisation des adresses… {geocoding.remaining} restante(s)
                </>
              )}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {loading && <p className="p-3 text-xs text-ink-4">Chargement…</p>}
          {!loading && filtered.length === 0 && <p className="p-3 text-xs italic text-ink-4">Aucune fiche.</p>}
          {filtered.slice(0, 500).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`block w-full px-3 py-2 text-left ${c.id === selectedId ? "bg-hover" : "hover:bg-hover"}`}
            >
              <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-ink">
                {c.lat == null && <MapPin size={11} className="shrink-0 text-ink-4" aria-label="Pas sur la carte" />}
                <span className="truncate">{c.club || c.name}</span>
                {c.club_number && <span className="shrink-0 font-normal text-ink-4">({c.club_number})</span>}
              </div>
              <div className="truncate text-[10px] text-ink-4">
                {[presidentName(c), [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}
              </div>
            </button>
          ))}
          {filtered.length > 500 && (
            <p className="p-3 text-center text-[10px] text-ink-4">
              {filtered.length - 500} autre(s) — affine la recherche pour les voir dans la liste (toutes sont sur la carte).
            </p>
          )}
        </div>
      </div>

      {/* Droite — carte + fiche */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-subtle">
        <div ref={mapDivRef} className="h-full w-full" />
        {!mapsLoaded && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-ink-4">Chargement de la carte…</div>
        )}

        {selected && (
          <div className="absolute left-3 top-3 max-h-[calc(100%-24px)] w-[320px] overflow-y-auto rounded-panel border border-line bg-card p-4 shadow-modal">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-ink">{selected.club || selected.name}</h3>
                {selected.club_number && <p className="text-[10px] text-ink-4">Club n° {selected.club_number}</p>}
              </div>
              <button onClick={() => setSelectedId(null)} className="shrink-0 text-ink-4 hover:text-ink">
                <X size={14} />
              </button>
            </div>

            {addressLine(selected) && (
              <div className="mb-3 flex items-start gap-2 text-xs text-ink-2">
                <MapPin size={13} className="mt-0.5 shrink-0 text-ink-4" />
                <div>
                  {addressLine(selected)}
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine(selected))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 flex items-center gap-1 font-semibold text-link hover:underline"
                  >
                    <Navigation size={11} /> Itinéraire
                  </a>
                </div>
              </div>
            )}

            <div className="space-y-1.5 border-t border-line pt-3 text-xs">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Président</p>
              <p className="font-semibold text-ink">
                {presidentName(selected)
                  ? [selected.civility, presidentName(selected)].filter(Boolean).join(" ")
                  : "Non renseigné"}
              </p>
              {selected.email && (
                <a href={`mailto:${selected.email}`} className="flex items-center gap-1.5 text-link hover:underline">
                  <Mail size={12} /> {selected.email}
                </a>
              )}
              {selected.email_secondary && (
                <a href={`mailto:${selected.email_secondary}`} className="flex items-center gap-1.5 text-link hover:underline">
                  <Mail size={12} /> {selected.email_secondary}
                </a>
              )}
              {selected.phone && (
                <div className="flex items-center gap-3">
                  <a href={`tel:${selected.phone}`} className="flex items-center gap-1.5 text-link hover:underline">
                    <Phone size={12} /> {formatFrPhone(selected.phone)}
                  </a>
                  {selected.phone.startsWith("+") && (
                    <a
                      href={`https://wa.me/${selected.phone.slice(1)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-semibold text-good hover:opacity-80"
                    >
                      <MessageCircle size={12} /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>

            {extraFields(selected).length > 0 && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
                {extraFields(selected).map(([k, v]) => (
                  <p key={k} className="text-ink-2">
                    <span className="text-ink-4">{k} : </span>
                    {v}
                  </p>
                ))}
              </div>
            )}

            {selected.lat == null && (
              <p className="mt-3 text-[10px] italic text-ink-4">Adresse non localisée : ce club n&rsquo;apparaît pas sur la carte.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
