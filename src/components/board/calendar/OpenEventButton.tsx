"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { mapEventRow, type CalendarEvent, type EventRow } from "@/lib/board/calendar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { EventModal } from "@/components/board/calendar/EventModal";
import { MobileEventModal } from "@/components/board/mobile/MobileEventModal";

const EVENT_SELECT =
  "id, title, event_type, start_date, end_date, location, online_meeting, registration_enabled, organizer_message, requires_coverage, created_by, created_at, updated_by, updated_at, status";

/**
 * « Voir l'événement » : charge l'événement et ouvre sa fiche complète (ordinateur ou mobile) par-
 * dessus l'écran courant — depuis une note de frais, une action du tableau de bord…
 */
export function OpenEventButton({ eventId, label = "Voir l'événement", className }: { eventId: string; label?: string; className?: string }) {
  const isMobile = useIsMobile();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    const { data } = await createClient().from("events").select(EVENT_SELECT).eq("id", eventId).single();
    setLoading(false);
    if (data) setEvent(mapEventRow(data as unknown as EventRow));
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className={className ?? "flex items-center gap-1 text-xs font-semibold text-link hover:underline disabled:opacity-50"}
      >
        <CalendarDays size={12} /> {loading ? "Ouverture…" : label}
      </button>
      {event && (
        // z-index au-dessus des modals du board (z-60) : la fiche s'ouvre par-dessus.
        <div className="relative z-[80]" onClick={(e) => e.stopPropagation()}>
          {isMobile ? (
            <MobileEventModal event={event} onClose={() => setEvent(null)} onSaved={() => setEvent(null)} />
          ) : (
            <EventModal event={event} onClose={() => setEvent(null)} onSaved={() => setEvent(null)} />
          )}
        </div>
      )}
    </>
  );
}
