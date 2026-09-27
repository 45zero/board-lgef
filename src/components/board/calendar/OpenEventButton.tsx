"use client";

import { CalendarDays } from "lucide-react";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";

/**
 * « Voir l'événement » en toutes lettres (en-têtes de fiches) : ouvre la fiche complète via
 * l'ouvreur global. Dans les listes, préférer la flèche discrète `EventArrow`.
 */
export function OpenEventButton({ eventId, label = "Voir l'événement", className }: { eventId: string; label?: string; className?: string }) {
  const { open, loadingId } = useOpenEvent();
  const loading = loadingId === eventId;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void open(eventId);
      }}
      disabled={loading}
      className={className ?? "flex items-center gap-1 text-xs font-semibold text-link hover:underline disabled:opacity-50"}
    >
      <CalendarDays size={12} /> {loading ? "Ouverture…" : label}
    </button>
  );
}
