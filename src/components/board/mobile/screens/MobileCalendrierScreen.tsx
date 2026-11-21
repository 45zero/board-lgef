"use client";

import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { DirectorGlyph } from "@/components/board/calendar/DirectorGlyph";
import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, User, Camera, Video, Mic } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { fr } from "date-fns/locale";
import { useCalendarEvents } from "@/hooks/board/useCalendarEvents";
import { useSolicitedFilter } from "@/hooks/board/useSolicitedFilter";
import { passesCoverageFilters, useCoverageFilters } from "@/hooks/board/useCoverageFilters";
import { useCalendarDefaults, type CalendarView } from "@/hooks/board/useCalendarDefaults";
import { CoverageGlyph } from "@/components/board/calendar/CoverageGlyph";
import { isMultiDayEvent, isMyEvent, CALENDAR_ORG_KEYS } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import type { CalendarEvent } from "@/lib/board/calendar";
import { MobileEventModal } from "@/components/board/mobile/MobileEventModal";
import { DayDrawer } from "@/components/board/calendar/DayDrawer";
import { useEventTeamCards } from "@/components/board/team/TeamCardOpener";
import { VoiceEventDialog } from "@/components/board/calendar/VoiceEvent";
import type { EventDraft } from "@/app/actions/event-dictation";
import { DayWeatherBadge, useForecast } from "@/components/board/calendar/DayWeather";
import { useMyTravelTimes } from "@/hooks/board/useMyTravelTimes";

type View = "mois" | "semaine";

/** Vue par défaut du compte (réglée au clic droit sur ordinateur) : Jour → Semaine, Carte → Mois. */
const MOBILE_VIEW: Record<CalendarView, View> = { day: "semaine", week: "semaine", month: "mois", map: "mois" };

export function MobileCalendrierScreen() {
  // Google Maps préchargé : la mini-carte d'itinéraire de la fiche s'affiche sans attendre le script.
  useGoogleMapsScript();
  const [calendarDefaults] = useCalendarDefaults();
  const [viewOverride, setView] = useState<View | null>(null);
  const view = viewOverride ?? MOBILE_VIEW[calendarDefaults.view];
  const forecast = useForecast();
  const [anchor, setAnchor] = useState(() => new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orgFilter, setOrgFilter] = useState<OrgKey | null>(null);
  const [mineOnly, setMineOnly] = useSolicitedFilter();
  const [coverage, setCoverage] = useCoverageFilters();
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const gridStart = useMemo(
    () =>
      view === "mois"
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1, locale: fr })
        : startOfWeek(anchor, { weekStartsOn: 1, locale: fr }),
    [anchor, view]
  );
  const gridEnd = useMemo(
    () =>
      view === "mois"
        ? endOfWeek(endOfMonth(anchor), { weekStartsOn: 1, locale: fr })
        : endOfWeek(anchor, { weekStartsOn: 1, locale: fr }),
    [anchor, view]
  );

  const days = useMemo(() => {
    const list: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) {
      list.push(d);
      d = addDays(d, 1);
    }
    return list;
  }, [gridStart, gridEnd]);

  const { events, refetch } = useCalendarEvents(gridStart, gridEnd);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (orgFilter && e.org !== orgFilter) return false;
      if (mineOnly && !isMyEvent(e)) return false;
      if (!passesCoverageFilters(e, coverage)) return false;
      return true;
    });
  }, [events, orgFilter, mineOnly, coverage]);

  // Point rouge sur le bouton des filtres : un filtre qui restreint l'affichage est actif.
  // Pastille du bouton filtres : catégorie choisie (les bascules sollicité / vidéo / photo sont visibles à côté).
  const filtersActive = !!orgFilter;

  const eventsForDay = (day: Date) =>
    filtered.filter((e) => isSameDay(parseISO(e.start), day)).sort((a, b) => a.start.localeCompare(b.start));

  // Un événement est "multi-jours" s'il s'étend sur plus d'une journée calendaire
  // locale (ex: BMF Apprentissage sur 4-5 jours) — rendu en bandeau plutôt qu'en
  // puce dans une seule case, comme dans le prototype (§6.4 du handoff).
  const isMultiDay = (e: CalendarEvent) => isMultiDayEvent(e);

  const multiDayEvents = useMemo(() => filtered.filter(isMultiDay), [filtered]);
  const singleDayEventsForDay = (day: Date) => eventsForDay(day).filter((e) => !isMultiDay(e));

  const weeks = useMemo(() => {
    const chunks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) chunks.push(days.slice(i, i + 7));
    return chunks;
  }, [days]);

  const bannersForWeek = (week: Date[]) => {
    const weekStart = week[0];
    const weekEnd = week[6];
    return multiDayEvents
      .filter((e) => parseISO(e.start) <= weekEnd && parseISO(e.end) >= weekStart)
      .map((e) => {
        const colStart = Math.max(0, differenceInCalendarDays(startOfDay(parseISO(e.start)), weekStart));
        // Une fin pile à minuit appartient au jour précédent (même règle que l'ordinateur).
        const colEnd = Math.min(6, differenceInCalendarDays(startOfDay(new Date(parseISO(e.end).getTime() - 1)), weekStart));
        return { event: e, colStart, colEnd };
      });
  };

  const orgCounts = useMemo(() => {
    const counts: Partial<Record<OrgKey, number>> = {};
    for (const e of events) counts[e.org] = (counts[e.org] ?? 0) + 1;
    return counts;
  }, [events]);

  // Panneau de la journée : tout ce qui touche le jour choisi, bandeaux de plusieurs jours compris.
  const dayEvents = useMemo(() => {
    if (!selectedDay) return [];
    const from = startOfDay(selectedDay).getTime();
    const to = from + 86_400_000;
    return filtered
      .filter((e) => parseISO(e.start).getTime() < to && parseISO(e.end).getTime() > from)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [selectedDay, filtered]);
  const dayTeamCards = useEventTeamCards(dayEvents.map((e) => e.id));
  // Mes seuls trajets : calculés côté serveur depuis mon adresse, pour les événements où je suis sollicité.
  const dayTravel = useMyTravelTimes(dayEvents);
  const closeDay = useCallback(() => setSelectedDay(null), []);
  const shiftDay = useCallback(
    (delta: number) =>
      setSelectedDay((d) => {
        if (!d) return d;
        const next = addDays(d, delta);
        // Hors de la période affichée : le mois ou la semaine suit.
        if (next < gridStart || next > gridEnd) setAnchor(next);
        return next;
      }),
    [gridStart, gridEnd]
  );

  const navPrev = () => setAnchor((a) => (view === "mois" ? subMonths(a, 1) : subWeeks(a, 1)));
  const navNext = () => setAnchor((a) => (view === "mois" ? addMonths(a, 1) : addWeeks(a, 1)));

  // Swipe horizontal sur la grille pour changer de mois/semaine — ne se déclenche
  // que si le geste est nettement horizontal, pour ne pas gêner le scroll vertical.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const handleSwipeStart = (e: React.PointerEvent) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const handleSwipeEnd = (e: React.PointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) navNext();
      else navPrev();
    }
  };
  const swipeHandlers = {
    onPointerDown: handleSwipeStart,
    onPointerUp: handleSwipeEnd,
    onPointerCancel: () => {
      swipeStart.current = null;
    },
  };

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-x-hidden">
      {/* Une seule ligne qui tient sur 375 px (iPhone) : filtres, bascules sollicité / vidéo / photo
          (toujours visibles), période, vue. */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="relative flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px] bg-card transition-transform"
          style={{
            borderColor: filtersOpen ? "var(--red)" : "var(--navy-600)",
            color: filtersOpen ? "var(--red)" : "var(--navy-600)",
            transform: filtersOpen ? "rotate(180deg)" : undefined,
          }}
          aria-label="Filtres"
        >
          <ChevronDown size={14} />
          {filtersActive && !filtersOpen && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red" />}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {[
            { on: mineOnly, icon: User, label: "Où je suis sollicité", toggle: () => setMineOnly(!mineOnly) },
            { on: coverage.video, icon: Video, label: "Matchs vidéo", toggle: () => setCoverage({ ...coverage, video: !coverage.video }) },
            { on: coverage.photo, icon: Camera, label: "Matchs photo", toggle: () => setCoverage({ ...coverage, photo: !coverage.photo }) },
          ].map(({ on, icon: Icon, label, toggle }) => (
            <button
              key={label}
              onClick={toggle}
              aria-pressed={on}
              aria-label={label}
              title={label}
              className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-[1.5px] ${
                on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3"
              }`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          <button onClick={navPrev} className="flex h-7 w-6 shrink-0 items-center justify-center rounded-btn text-ink-3" aria-label="Période précédente">
            <ChevronLeft size={16} />
          </button>
          <span className="truncate text-[13px] font-extrabold uppercase text-navy-600">
            {format(anchor, view === "mois" ? "MMM yyyy" : "'Sem.' I · MMM", { locale: fr })}
          </span>
          <button onClick={navNext} className="flex h-7 w-6 shrink-0 items-center justify-center rounded-btn text-ink-3" aria-label="Période suivante">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-subtle p-0.5">
          {(["semaine", "mois"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-2 py-1 text-[11px] font-bold transition-colors ${
                view === v ? "bg-card text-ink shadow-card" : "text-ink-3"
              }`}
            >
              {v === "semaine" ? "Sem." : "Mois"}
            </button>
          ))}
        </div>
      </div>

      {filtersOpen && (
        <div className="grid grid-cols-5 gap-1.5 px-3 pb-2 pt-1">
          {CALENDAR_ORG_KEYS.map((key) => {
            const active = orgFilter === key;
            const color = ORG_COLORS[key];
            return (
              <button
                key={key}
                onClick={() => setOrgFilter((prev) => (prev === key ? null : key))}
                title={ORG_LABELS[key]}
                className="relative flex h-[33px] items-center justify-center rounded-btn border-2 text-[13px] font-extrabold"
                style={{
                  borderColor: color.base,
                  background: active ? color.bg : "transparent",
                  color: color.ink,
                }}
              >
                {ORG_LABELS[key].slice(0, 2).toUpperCase()}
                {(orgCounts[key] ?? 0) > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
                    style={{ background: color.base }}
                  >
                    {orgCounts[key]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {view === "mois" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-1" style={{ touchAction: "pan-y" }} {...swipeHandlers}>
          {/* Le mois remplit l'écran quand il est calme ; une semaine chargée s'agrandit pour montrer tous ses
              événements (rien n'est coupé) et la grille défile alors verticalement. */}
          <div className="grid grid-cols-7 pb-1">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <div key={i} className="text-center font-mono text-[9px] uppercase text-ink-4">
                {d}
              </div>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t border-line bg-card">
            {weeks.map((week, weekIdx) => {
              const banners = bannersForWeek(week);
              return (
                <div
                  key={week[0].toISOString()}
                  className={`grid min-h-[72px] flex-[1_0_auto] grid-cols-7 ${weekIdx > 0 ? "border-t border-line" : ""}`}
                  style={{ gridTemplateRows: `1fr repeat(${banners.length}, auto)` }}
                >
                  {week.map((day, dayIdx) => {
                    const dayEvents = singleDayEventsForDay(day);
                    const inMonth = isSameMonth(day, anchor);
                    const isToday = isSameDay(day, new Date());
                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => setSelectedDay(day)}
                        aria-label={`${format(day, "EEEE d MMMM", { locale: fr })} — ${dayEvents.length} événement${dayEvents.length > 1 ? "s" : ""}`}
                        className={`flex h-full min-w-0 flex-col gap-[3px] p-1 text-left active:bg-hover ${
                          dayIdx > 0 ? "border-l border-line" : ""
                        } ${inMonth ? "bg-card" : "bg-subtle/40 opacity-50"}`}
                      >
                        <span className="flex items-center justify-between gap-0.5">
                          <span
                            className={`rounded-full px-1 text-[10px] font-bold ${
                              isToday ? "bg-red text-white" : "text-ink-2"
                            }`}
                          >
                            {format(day, "d")}
                          </span>
                          {inMonth && (
                            <span className="text-ink-3">
                              <DayWeatherBadge day={day} forecast={forecast} compact />
                            </span>
                          )}
                        </span>
                        {dayEvents.map((ev) => (
                          <span
                            key={ev.id}
                            className="flex shrink-0 items-center gap-0.5 overflow-hidden rounded-[4px] pr-0.5"
                            style={{ background: ORG_COLORS[ev.org].bg, height: 16 }}
                          >
                            <span className="h-full w-[3px] shrink-0" style={{ background: ORG_COLORS[ev.org].base }} />
                            <span
                              className="min-w-0 flex-1 truncate text-[8.5px] font-bold leading-none"
                              style={{ color: ORG_COLORS[ev.org].ink }}
                            >
                              {ev.title}
                            </span>
                            <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={9} />
<DirectorGlyph status={ev.director} size={10} />
                          </span>
                        ))}
                      </button>
                    );
                  })}

                  {banners.map(({ event: ev, colStart, colEnd }) => (
                    <button
                      key={ev.id}
                      onClick={() => setEditing(ev)}
                      className="mt-0.5 flex h-[18px] items-center gap-1.5 overflow-hidden rounded-[6px] px-1.5"
                      style={{
                        gridColumn: `${colStart + 1} / ${colEnd + 2}`,
                        background: ORG_COLORS[ev.org].bg,
                        color: ORG_COLORS[ev.org].ink,
                      }}
                    >
                      <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: ORG_COLORS[ev.org].base }} />
                      <span className="min-w-0 flex-1 truncate text-left text-[10.5px] font-bold">{ev.title}</span>
                      <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
<DirectorGlyph status={ev.director} size={10} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 pb-2" style={{ touchAction: "pan-y" }} {...swipeHandlers}>
          {days.map((day) => {
            const dayEvents = eventsForDay(day);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                className={`flex w-full items-start gap-3 rounded-btn border border-line bg-card p-2.5 text-left ${
                  isToday ? "ring-2 ring-red" : ""
                }`}
              >
                <div className="w-9 shrink-0 text-center">
                  <div className="font-mono text-[9px] uppercase text-ink-4">{format(day, "EEE", { locale: fr })}</div>
                  <div className="text-sm font-extrabold text-ink">{format(day, "d")}</div>
                  <div className="mt-0.5 flex justify-center text-ink-3">
                    <DayWeatherBadge day={day} forecast={forecast} compact />
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  {dayEvents.length === 0 && <div className="text-xs text-ink-4">Aucun événement</div>}
                  {dayEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: ORG_COLORS[ev.org].base }} />
                      <span className="font-mono text-[10px] text-ink-4">{format(parseISO(ev.start), "HH:mm")}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink-2">{ev.title}</span>
                      <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={11} />
<DirectorGlyph status={ev.director} size={10} />
                    </div>
                  ))}
                </div>
                {dayEvents.length > 0 && (
                  <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-bold text-ink-3">
                    {dayEvents.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Même panneau de la journée que sur ordinateur (trajets compris). */}
      <DayDrawer
        mobile
        day={selectedDay}
        events={dayEvents}
        googleEvents={[]}
        forecast={forecast}
        teamCards={dayTeamCards}
        travel={dayTravel}
        paused={!!editing || voiceOpen}
        onClose={closeDay}
        onShiftDay={shiftDay}
        onOpenEvent={(ev) => setEditing(ev)}
        onOpenGoogle={() => {}}
        onCreate={() => setEditing("new")}
        onVoice={() => setVoiceOpen(true)}
      />

      {/* Création à la voix : bouton flottant, toujours à portée de pouce. */}
      {!selectedDay && !editing && (
        <button
          onClick={() => setVoiceOpen(true)}
          className="absolute bottom-3 right-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white shadow-modal"
          aria-label="Créer un événement à la voix"
        >
          <Mic size={20} />
        </button>
      )}

      {editing && (
        <MobileEventModal
          event={editing === "new" ? null : editing}
          defaultStart={selectedDay ?? undefined}
          draft={editing === "new" ? draft : null}
          onClose={() => {
            setEditing(null);
            setDraft(null);
          }}
          onSaved={refetch}
        />
      )}

      {voiceOpen && (
        <VoiceEventDialog
          mobile
          onClose={() => setVoiceOpen(false)}
          onDraft={(d) => {
            setVoiceOpen(false);
            setDraft(d);
            setEditing("new");
          }}
        />
      )}
    </div>
  );
}
