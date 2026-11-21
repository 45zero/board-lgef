"use client";

import { useEffect, useRef, useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarDays, Car, ChevronLeft, ChevronRight, ChevronsRight, MapPin, Mic, Plus, Video } from "lucide-react";
import { ORG_COLORS } from "@/lib/board/tokens";
import { isMultiDayEvent, type CalendarEvent } from "@/lib/board/calendar";
import { CoverageGlyph } from "@/components/board/calendar/CoverageGlyph";
import { DirectorGlyph } from "@/components/board/calendar/DirectorGlyph";
import { DayWeatherBadge, type useForecast } from "@/components/board/calendar/DayWeather";
import { TeamCardGlyph } from "@/components/board/team/TeamCardOpener";
import { DEPARTURE_MARGIN_MIN, departureTime, formatTravel, type Travel } from "@/lib/board/geo";

type GoogleItem = { id: string; summary: string; start: string; end: string };

/**
 * Journée en panneau latéral (ordinateur) : clic sur un jour de la vue Mois ou Semaine. Le calendrier
 * reste en place derrière ; on lit la journée, on ouvre un événement, on passe au jour voisin, puis on
 * replie. « Vue Jour » reste à un clic pour la grille horaire complète.
 * Même panneau sur téléphone (`mobile`) : presque toute la largeur, en-tête pensé pour le pouce,
 * glisser vers la droite pour replier, marges des zones sûres de l'iPhone.
 */
export function DayDrawer({
  day,
  events,
  googleEvents,
  forecast,
  teamCards,
  travel,
  paused,
  onClose,
  onShiftDay,
  onOpenEvent,
  onOpenGoogle,
  onCreate,
  onVoice,
  onOpenDayView,
  mobile = false,
}: {
  day: Date | null;
  /** Événements internes qui touchent ce jour (ceux de plusieurs jours compris). */
  events: CalendarEvent[];
  googleEvents: GoogleItem[];
  forecast: ReturnType<typeof useForecast>;
  teamCards: Record<string, { id: string; title: string }[]>;
  /**
   * Temps de route depuis le domicile de la personne connectée, pour ses seuls événements où elle est
   * sollicitée (calculé côté serveur avec sa propre adresse : jamais le trajet de quelqu'un d'autre).
   */
  travel: Record<string, Travel>;
  /** Une fiche est ouverte par-dessus : Échap et les flèches du clavier lui reviennent. */
  paused: boolean;
  onClose: () => void;
  onShiftDay: (delta: number) => void;
  onOpenEvent: (ev: CalendarEvent) => void;
  onOpenGoogle: (id: string) => void;
  onCreate: () => void;
  onVoice: () => void;
  /** Absent sur téléphone (pas de vue Jour) : le bouton n'est pas affiché. */
  onOpenDayView?: () => void;
  mobile?: boolean;
}) {
  const open = !!day;
  // Le dernier jour reste affiché pendant l'animation de fermeture.
  const [shown, setShown] = useState<Date | null>(day);
  if (day && (!shown || day.getTime() !== shown.getTime())) setShown(day);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Téléphone : glisser le panneau vers la droite le replie (le doigt le suit).
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  // Heure courante, rafraîchie chaque minute tant que le panneau est ouvert (ligne « Maintenant »).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open || mobile) return;
    closeRef.current?.focus({ preventScroll: true });
  }, [open, mobile]);

  const swipeHandlers = mobile
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse") return;
          swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        },
        onPointerMove: (e: React.PointerEvent) => {
          const st = swipe.current;
          if (!st || st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          const dy = e.clientY - st.y;
          // Geste vertical : c'est un défilement de la liste, on laisse faire.
          if (dragX === 0 && Math.abs(dy) > Math.abs(dx)) {
            swipe.current = null;
            return;
          }
          if (dx > 8) setDragX(dx);
        },
        onPointerUp: () => {
          if (swipe.current && dragX > 90) onClose();
          swipe.current = null;
          setDragX(0);
        },
        onPointerCancel: () => {
          swipe.current = null;
          setDragX(0);
        },
      }
    : {};

  useEffect(() => {
    if (!open || paused) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onShiftDay(-1);
      else if (e.key === "ArrowRight") onShiftDay(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, paused, onClose, onShiftDay]);

  const d = shown ?? new Date();
  const multi = events.filter(isMultiDayEvent);
  const timed = [
    ...events.filter((e) => !isMultiDayEvent(e)).map((ev) => ({ kind: "internal" as const, ev, start: ev.start, end: ev.end })),
    ...googleEvents.map((g) => ({ kind: "google" as const, g, start: g.start, end: g.end })),
  ].sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime() || parseISO(a.end).getTime() - parseISO(b.end).getTime());
  const total = multi.length + timed.length;

  const isToday = isSameDay(d, nowMs);
  // Ligne « Maintenant » avant le premier événement pas encore terminé (aujourd'hui seulement).
  const nowIndex = isToday ? timed.findIndex((t) => parseISO(t.end).getTime() > nowMs) : -1;
  // Créneaux qui en chevauchent un autre : signalés, pour repérer les doublons de personnel.
  const overlapping = new Set<number>();
  const ms = timed.map((t) => [parseISO(t.start).getTime(), parseISO(t.end).getTime()] as const);
  ms.forEach(([as, ae], i) =>
    ms.forEach(([bs, be], j) => {
      if (i < j && as < be && bs < ae) {
        overlapping.add(i);
        overlapping.add(j);
      }
    })
  );
  const tab = open ? 0 : -1;

  // Mes trajets du jour : premier départ et total, en tête du panneau.
  const trips = timed
    .filter((t): t is Extract<typeof t, { kind: "internal" }> => t.kind === "internal" && !!travel[t.ev.id])
    .map((t) => ({ ev: t.ev, travel: travel[t.ev.id], departure: departureTime(t.ev.start, travel[t.ev.id].minutes) }));
  const firstDeparture = trips.reduce<Date | null>((m, t) => (!m || t.departure < m ? t.departure : m), null);
  const tripKm = trips.reduce((n, t) => n + t.travel.km, 0);

  return (
    <div className={`fixed inset-0 z-40 ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Replier la journée"
        onClick={onClose}
        className={`absolute inset-0 bg-black/15 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />

      <aside
        role="dialog"
        aria-label={`Journée du ${format(d, "EEEE d MMMM yyyy", { locale: fr })}`}
        className={`absolute bottom-0 right-0 top-0 flex flex-col border-l border-line bg-card shadow-modal ${
          dragX ? "" : "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        } ${mobile ? "w-[calc(100%-44px)] rounded-l-sheet" : "w-[440px] max-w-[92vw]"} ${open ? "translate-x-0" : "translate-x-full"}`}
        style={dragX ? { transform: `translateX(${dragX}px)`, touchAction: "pan-y" } : mobile ? { touchAction: "pan-y" } : undefined}
        {...swipeHandlers}
      >
        {/* Languette de repli, collée au bord du panneau. */}
        <button
          type="button"
          onClick={onClose}
          tabIndex={tab}
          aria-label="Replier le panneau"
          title="Replier (Échap)"
          className={`absolute -left-9 top-1/2 flex h-16 w-9 -translate-y-1/2 items-center justify-center rounded-l-panel border border-r-0 border-line bg-card text-ink-3 shadow-card transition-opacity hover:text-navy ${
            open ? "opacity-100" : "opacity-0"
          }`}
        >
          <ChevronsRight size={18} />
        </button>

{mobile ? (
        <header className="border-b border-line px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">
              {total === 0 ? "Aucun événement" : `${total} événement${total > 1 ? "s" : ""}`}
              {isToday && <span className="ml-1.5 rounded-full bg-red px-1.5 py-px text-[9px] font-bold text-white">Aujourd&rsquo;hui</span>}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              tabIndex={tab}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-navy pl-3.5 pr-2.5 text-[13px] font-semibold text-white active:bg-navy-600"
            >
              Replier <ChevronsRight size={16} />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => onShiftDay(-1)}
              tabIndex={tab}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-3 active:bg-hover"
              aria-label="Jour précédent"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <h2 className="truncate text-[17px] font-extrabold capitalize leading-tight text-ink">{format(d, "EEEE d MMMM", { locale: fr })}</h2>
              <div className="flex h-4 justify-center text-ink-3">
                <DayWeatherBadge day={d} forecast={forecast} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => onShiftDay(1)}
              tabIndex={tab}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-3 active:bg-hover"
              aria-label="Jour suivant"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </header>
        ) : (
        <header className="flex items-start gap-2 border-b border-line px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">
              {total === 0 ? "Aucun événement" : `${total} événement${total > 1 ? "s" : ""}`}
              {isToday && <span className="ml-1.5 rounded-full bg-red px-1.5 py-px text-[9px] font-bold text-white">Aujourd&rsquo;hui</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <h2 className="truncate text-[17px] font-extrabold capitalize text-ink">{format(d, "EEEE d MMMM", { locale: fr })}</h2>
              <span className="text-ink-3">
                <DayWeatherBadge day={d} forecast={forecast} />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onShiftDay(-1)}
              tabIndex={tab}
              className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
              aria-label="Jour précédent"
              title="Jour précédent (←)"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => onShiftDay(1)}
              tabIndex={tab}
              className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
              aria-label="Jour suivant"
              title="Jour suivant (→)"
            >
              <ChevronRight size={15} />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              tabIndex={tab}
              className="ml-1 flex h-8 items-center gap-1 rounded-btn bg-navy px-2.5 text-xs font-semibold text-white hover:bg-navy-600"
              title="Replier (Échap)"
            >
              Replier <ChevronsRight size={14} />
            </button>
          </div>
        </header>
        )}

        {firstDeparture && (
          <div className="flex items-center gap-2.5 border-b border-line bg-subtle/60 px-4 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white">
              <Car size={15} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13px] font-bold text-ink">
                Premier départ à {format(firstDeparture, "HH:mm")}
              </div>
              <div className="text-[11px] text-ink-3">
                {trips.length} trajet{trips.length > 1 ? "s" : ""} aller depuis chez vous · {Math.round(tripKm)} km
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {multi.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4">Sur plusieurs jours</h3>
              <div className="space-y-1.5">
                {multi.map((ev) => {
                  const color = ORG_COLORS[ev.org];
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onOpenEvent(ev)}
                      tabIndex={tab}
                      className={`flex w-full items-center gap-2 rounded-btn border-l-4 px-3 py-2 text-left transition-shadow hover:shadow-card ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                      style={{ background: color.bg, borderLeftColor: color.base, color: color.ink }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{ev.title}</span>
                        <span className="block font-mono text-[10px] opacity-80">
                          du {format(parseISO(ev.start), "d MMM HH:mm", { locale: fr })} au {format(parseISO(ev.end), "d MMM HH:mm", { locale: fr })}
                        </span>
                      </span>
                      <Glyphs ev={ev} cards={teamCards[ev.id]} color={color.ink} />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {total === 0 && (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-panel border border-dashed border-line px-6 py-10 text-center">
              <CalendarDays size={22} className="text-ink-4" />
              <div className="text-sm font-semibold text-ink-2">Journée libre</div>
              <div className="text-xs text-ink-4">Aucun événement avec les filtres affichés.</div>
            </div>
          )}

          <ol>
            {timed.flatMap((t, i) => {
              const past = isToday && parseISO(t.end).getTime() <= nowMs;
              const items = [];
              if (i === nowIndex) {
                items.push(
                  <li key="now" aria-label="Maintenant" className="my-2 flex items-center gap-2">
                    <span className="w-[52px] text-right font-mono text-[10px] font-bold text-red">{format(nowMs, "HH:mm")}</span>
                    <span className="h-2 w-2 rounded-full bg-red" />
                    <span className="h-0.5 flex-1 bg-red" />
                  </li>
                );
              }
              const time = (
                <span className="w-[52px] shrink-0 pt-2 text-right font-mono leading-tight">
                  <span className="block text-[12px] font-bold text-ink-2">{format(parseISO(t.start), "HH:mm")}</span>
                  <span className="block text-[10px] text-ink-4">{format(parseISO(t.end), "HH:mm")}</span>
                </span>
              );
              if (t.kind === "google") {
                items.push(
                  <li key={`g-${t.g.id}`} className={`flex gap-3 py-1 ${past ? "opacity-55" : ""}`}>
                    {time}
                    <button
                      type="button"
                      onClick={() => onOpenGoogle(t.g.id)}
                      tabIndex={tab}
                      className="min-w-0 flex-1 rounded-btn border border-dashed border-line-strong px-3 py-2 text-left hover:bg-hover"
                    >
                      <span className="block font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">Google</span>
                      <span className="block text-[13px] font-semibold text-ink-2" style={{ overflowWrap: "anywhere" }}>
                        {t.g.summary}
                      </span>
                    </button>
                  </li>
                );
                return items;
              }
              const ev = t.ev;
              const color = ORG_COLORS[ev.org];
              const trip = travel[ev.id];
              if (trip) {
                const dep = departureTime(ev.start, trip.minutes);
                const depPast = isToday && dep.getTime() <= nowMs;
                items.push(
                  <li key={`trip-${ev.id}`} className={`flex gap-3 pt-1 ${past ? "opacity-55" : ""}`}>
                    <span className="w-[52px] shrink-0 pt-1.5 text-right font-mono leading-tight">
                      <span className="block text-[12px] font-bold" style={{ color: color.ink }}>{format(dep, "HH:mm")}</span>
                      <span className="block text-[9.5px] text-ink-4">départ</span>
                    </span>
                    <div
                      className="relative min-w-0 flex-1 rounded-btn border-2 border-dashed px-3 py-1.5"
                      style={{ borderColor: color.base, color: color.ink }}
                      title={`Heure de départ conseillée : temps de route + ${DEPARTURE_MARGIN_MIN} min de marge`}
                    >
                      <span className="flex items-center gap-1.5 text-[12px] font-bold">
                        <Car size={13} className="shrink-0" />
                        {depPast && !past ? "Vous devriez être en route" : `Partir à ${format(dep, "HH:mm")}`}
                      </span>
                      <span className="block text-[11px] opacity-80">
                        {formatTravel(trip)} de route · marge {DEPARTURE_MARGIN_MIN} min
                      </span>
                      {/* Trait qui relie le départ à l'événement. */}
                      <span aria-hidden className="absolute -bottom-[7px] left-4 h-[6px] w-0 border-l-2 border-dashed" style={{ borderColor: color.base }} />
                    </div>
                  </li>
                );
              }
              items.push(
                <li key={ev.id} className={`flex gap-3 ${trip ? "pb-1 pt-1.5" : "py-1"} ${past ? "opacity-55" : ""}`}>
                  {time}
                  <button
                    type="button"
                    onClick={() => onOpenEvent(ev)}
                    tabIndex={tab}
                    className={`min-w-0 flex-1 rounded-btn border-l-4 px-3 py-2 text-left transition-shadow hover:shadow-card ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                    style={{ background: color.bg, borderLeftColor: color.base, color: color.ink }}
                  >
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-bold leading-snug" style={{ overflowWrap: "anywhere" }}>
                        {ev.title}
                      </span>
                      <Glyphs ev={ev} cards={teamCards[ev.id]} color={color.ink} />
                    </span>
                    {(ev.location || ev.onlineMeeting) && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
                        {ev.onlineMeeting ? <Video size={11} className="shrink-0" /> : <MapPin size={11} className="shrink-0" />}
                        <span className="truncate">{ev.onlineMeeting ? "En visio" : ev.location}</span>
                      </span>
                    )}
                    {overlapping.has(i) && (
                      <span className="mt-1 inline-block rounded-full bg-card/70 px-1.5 py-px text-[9.5px] font-semibold">
                        En même temps qu&rsquo;un autre événement
                      </span>
                    )}
                  </button>
                </li>
              );
              return items;
            })}
          </ol>
        </div>

        <footer className={`flex items-center gap-2 border-t border-line ${mobile ? "px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5" : "px-4 py-3"}`}>
          <button
            type="button"
            onClick={onCreate}
            tabIndex={tab}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-navy font-semibold text-white hover:bg-navy-600 ${mobile ? "h-11 text-[13px]" : "h-9 text-xs"}`}
          >
            <Plus size={14} /> Nouvel événement
          </button>
          <button
            type="button"
            onClick={onVoice}
            tabIndex={tab}
            className={`flex items-center justify-center rounded-btn border border-line text-navy hover:bg-hover ${mobile ? "h-11 w-11" : "h-9 w-9"}`}
            aria-label="Créer un événement à la voix"
            title="Créer un événement à la voix"
          >
            <Mic size={15} />
          </button>
          {onOpenDayView && (
          <button
            type="button"
            onClick={onOpenDayView}
            tabIndex={tab}
            className="flex h-9 items-center gap-1.5 rounded-btn border border-line px-3 text-xs font-semibold text-ink-2 hover:bg-hover"
            title="Ouvrir la grille horaire de la journée"
          >
            <CalendarDays size={14} /> Vue Jour
          </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

function Glyphs({ ev, cards, color }: { ev: CalendarEvent; cards: { id: string; title: string }[] | undefined; color: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 pt-0.5">
      <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={12} />
      <DirectorGlyph status={ev.director} size={12} />
      <TeamCardGlyph cards={cards} size={12} color={color} />
    </span>
  );
}
