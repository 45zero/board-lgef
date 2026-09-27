"use client";

import { MapPin, Navigation, X } from "lucide-react";

/**
 * Carte d'un lieu dans une fenêtre, sans quitter le board (carte Google intégrée). « Itinéraire »
 * ouvre l'appli de navigation, sur demande uniquement.
 */
export function MapPopup({ location, title, onClose }: { location: string; title?: string; onClose: () => void }) {
  const q = encodeURIComponent(location);
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex h-[min(560px,85vh)] w-full max-w-2xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <MapPin size={15} className="shrink-0 text-red" />
          <div className="min-w-0 flex-1">
            {title && <div className="truncate text-sm font-bold text-ink">{title}</div>}
            <div className="truncate text-xs text-ink-3">{location}</div>
          </div>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1 rounded-btn border border-line px-2.5 py-1.5 text-xs font-semibold text-link hover:bg-hover"
          >
            <Navigation size={12} /> Itinéraire
          </a>
          <button onClick={onClose} className="shrink-0 rounded-full p-1 text-ink-4 hover:bg-hover hover:text-ink" aria-label="Fermer la carte">
            <X size={17} />
          </button>
        </div>
        <iframe title={`Carte — ${location}`} src={`https://maps.google.com/maps?q=${q}&z=15&output=embed`} className="w-full flex-1 border-0" loading="lazy" />
      </div>
    </div>
  );
}
