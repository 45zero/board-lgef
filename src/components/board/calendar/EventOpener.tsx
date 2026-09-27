"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { mapEventRow, type CalendarEvent, type EventRow } from "@/lib/board/calendar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { EventModal } from "@/components/board/calendar/EventModal";
import { MobileEventModal } from "@/components/board/mobile/MobileEventModal";

const EVENT_SELECT =
  "id, title, event_type, start_date, end_date, location, online_meeting, registration_enabled, organizer_message, requires_coverage, created_by, created_at, updated_by, updated_at, status";

type OpenEvent = (eventId: string) => Promise<void>;

const EventOpenerContext = createContext<{ open: OpenEvent; loadingId: string | null } | null>(null);

/**
 * Ouvre la fiche d'un événement (ordinateur ou mobile) par-dessus n'importe quel écran : un seul
 * modal pour tout le board, au-dessus des popups (z-60). Gère aussi le lien `?openEvent=<id>`
 * (notifications, e-mails).
 */
export function EventOpenerProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback<OpenEvent>(async (eventId) => {
    setLoadingId(eventId);
    setError(null);
    const { data, error: err } = await createClient().from("events").select(EVENT_SELECT).eq("id", eventId).maybeSingle();
    setLoadingId(null);
    if (err || !data) {
      setError(err ? "Impossible d'ouvrir l'événement." : "Cet événement n'existe plus ou ne vous est pas accessible.");
      window.setTimeout(() => setError(null), 4000);
      return;
    }
    setEvent(mapEventRow(data as unknown as EventRow));
  }, []);

  // Lien profond ?openEvent=<id> : ouvre la fiche puis nettoie l'URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("openEvent");
    if (!id) return;
    url.searchParams.delete("openEvent");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    queueMicrotask(() => void open(id));
  }, [open]);

  return (
    <EventOpenerContext.Provider value={{ open, loadingId }}>
      {children}
      {event && (
        <div className="relative z-[80]" onClick={(e) => e.stopPropagation()}>
          {isMobile ? (
            <MobileEventModal event={event} onClose={() => setEvent(null)} onSaved={() => setEvent(null)} />
          ) : (
            <EventModal event={event} onClose={() => setEvent(null)} onSaved={() => setEvent(null)} />
          )}
        </div>
      )}
      {error && (
        <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-btn bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-modal">
          {error}
        </div>
      )}
    </EventOpenerContext.Provider>
  );
}

export function useOpenEvent() {
  const ctx = useContext(EventOpenerContext);
  if (!ctx) throw new Error("useOpenEvent doit être utilisé sous <EventOpenerProvider>.");
  return ctx;
}

/**
 * Petite flèche discrète (mais visible) qui ouvre la fiche de l'événement. Rendue en `span` pour
 * pouvoir se placer dans une ligne déjà cliquable (bouton) sans imbriquer deux boutons.
 */
export function EventArrow({ eventId, className = "", tone = "default" }: { eventId: string; className?: string; tone?: "default" | "light" }) {
  const { open, loadingId } = useOpenEvent();
  const loading = loadingId === eventId;
  const trigger = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!loading) void open(eventId);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title="Ouvrir l'événement"
      aria-label="Ouvrir l'événement"
      onClick={trigger}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && trigger(e)}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
        tone === "light" ? "border-white/40 text-white hover:bg-white/15" : "border-line text-link hover:border-link hover:bg-sel-bg"
      } ${className}`}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={14} strokeWidth={2.5} />}
    </span>
  );
}
