"use client";

import { CoverageToggle } from "@/components/board/calendar/CoverageToggle";
import { TeamCardGlyph, useEventTeamCards } from "@/components/board/team/TeamCardOpener";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, User, X, PanelLeftOpen, Camera, Video } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
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
import { DayWeatherBadge, useForecast } from "@/components/board/calendar/DayWeather";
import { CoverageGlyph } from "@/components/board/calendar/CoverageGlyph";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { listMyCalendars, listMyEvents } from "@/app/actions/calendar";
import { EventModal } from "@/components/board/calendar/EventModal";
import { GoogleEventModal } from "@/components/board/calendar/GoogleEventModal";
import { ORG_COLORS, type OrgKey } from "@/lib/board/tokens";
import { CalendarSidebar } from "@/components/board/calendar/CalendarSidebar";
import { StaffEventsMap } from "@/components/board/calendar/StaffEventsMap";
import type { CalendarEvent } from "@/lib/board/calendar";

const HOUR_START = 8;
const HOUR_END = 20;
const PX_PER_HOUR = 56;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const WEEK_OPTS = { weekStartsOn: 1 as const, locale: fr };

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type GoogleEventItem = Awaited<ReturnType<typeof listMyEvents>>[number];
type ViewMode = "day" | "week" | "month" | "map";

function hourFloat(iso: string) {
  const d = parseISO(iso);
  return d.getHours() + d.getMinutes() / 60;
}

function blockStyle(startISO: string, endISO: string) {
  const top = Math.max(0, (hourFloat(startISO) - HOUR_START) * PX_PER_HOUR);
  const height = Math.max(40, (hourFloat(endISO) - hourFloat(startISO)) * PX_PER_HOUR - 4);
  return { top, height: Math.min(height, GRID_HEIGHT - top) };
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
  { id: "map", label: "Carte" },
];

export function CalendrierScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const forecast = useForecast();
  const [anchorDate, setAnchorDate] = useState(() => new Date());

  const weekStart = useMemo(() => startOfWeek(anchorDate, WEEK_OPTS), [anchorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const monthGridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(anchorDate), WEEK_OPTS);
    const gridEnd = endOfWeek(endOfMonth(anchorDate), WEEK_OPTS);
    const days: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
    return days;
  }, [anchorDate]);

  // Carte : sa propre période (mois, semaine ou jour) pilote la plage, les flèches et le libellé.
  const [mapPeriod, setMapPeriod] = useState<"month" | "week" | "day">("month");
  const period = viewMode === "map" ? mapPeriod : viewMode;

  const displayDays = useMemo(() => {
    if (period === "day") return [anchorDate];
    if (period === "week") return weekDays;
    // Carte au mois : les événements du mois affiché, sans les jours de débordement de la grille.
    if (viewMode === "map") return monthGridDays.filter((d) => isSameMonth(d, anchorDate));
    return monthGridDays;
  }, [period, viewMode, anchorDate, weekDays, monthGridDays]);
  const rangeStart = useMemo(() => startOfDay(displayDays[0]), [displayDays]);
  const rangeEnd = useMemo(() => endOfDay(displayDays[displayDays.length - 1]), [displayDays]);

  const { events, refetch } = useCalendarEvents(rangeStart, rangeEnd);

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [googleAccountId, setGoogleAccountId] = useState<string | null>(null);
  const [googleCalendarId] = useState("primary");
  const [googleEvents, setGoogleEvents] = useState<GoogleEventItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage on mount
      setSidebarCollapsed(window.localStorage.getItem("board-lgef:calendar-sidebar-collapsed") === "1");
    } catch {
      // localStorage indisponible — on reste déplié = false
    }
  }, []);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("board-lgef:calendar-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // sans conséquence — la préférence vivra juste pour la session en cours
      }
      return next;
    });
  };

  const [editingInternal, setEditingInternal] = useState<CalendarEvent | "new" | null>(null);
  const [newSlot, setNewSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [editingGoogle, setEditingGoogle] = useState<GoogleEventItem | "new" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenOrgs, setHiddenOrgs] = useState<Set<OrgKey>>(() => new Set());
  const [mineOnly, setMineOnly] = useSolicitedFilter();
  const [coverage, setCoverage, coverageDefaults, setCoverageDefault] = useCoverageFilters();

  const toggleOrgVisibility = (key: OrgKey) => {
    setHiddenOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const refetchGoogleEvents = () => {
    if (!googleAccountId) return;
    listMyEvents(googleAccountId, {
      calendarId: googleCalendarId,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
    })
      .then(setGoogleEvents)
      .catch(() => setGoogleEvents([]));
  };

  useEffect(() => {
    getMyConnectedAccounts().then((accs) => {
      setAccounts(accs);
      if (accs.length > 0) setGoogleAccountId(accs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!googleAccountId) return;
    listMyCalendars(googleAccountId).catch(() => []);
  }, [googleAccountId]);

  useEffect(() => {
    if (!googleAccountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on disconnect, no async fetch involved
      setGoogleEvents([]);
      return;
    }
    refetchGoogleEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAccountId, googleCalendarId, rangeStart, rangeEnd]);

  const visibleEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (mineOnly && !e.solicited) return false;
      if (!passesCoverageFilters(e, coverage)) return false;
      if (hiddenOrgs.has(e.org)) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, searchQuery, hiddenOrgs, mineOnly, coverage]);

  const teamCards = useEventTeamCards(visibleEvents.map((e) => e.id));
  const eventsForDay = (day: Date) => visibleEvents.filter((e) => isSameDay(parseISO(e.start), day));
  const googleEventsForDay = (day: Date) =>
    googleEvents.filter((e) => !e.allDay && isSameDay(parseISO(e.start), day));

  const plannedMinutes = useMemo(
    () =>
      events.reduce(
        (sum, e) => sum + Math.max(0, (parseISO(e.end).getTime() - parseISO(e.start).getTime()) / 60000),
        0
      ),
    [events]
  );
  const plannedLabel = useMemo(() => {
    const h = Math.floor(plannedMinutes / 60);
    const m = Math.round(plannedMinutes % 60);
    return `${h} h${m > 0 ? ` ${m.toString().padStart(2, "0")}` : ""}`;
  }, [plannedMinutes]);
  // 35h/semaine posée comme capacité de référence — pas de vraie notion de disponibilité en base.
  const availabilityPct = Math.max(0, Math.min(100, Math.round(100 - (plannedMinutes / 60 / 35) * 100)));

  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60 - HOUR_START) * PX_PER_HOUR;
  const showNowLine = nowTop >= 0 && nowTop <= GRID_HEIGHT;

  const goPrev = () => {
    if (period === "day") setAnchorDate((d) => addDays(d, -1));
    else if (period === "week") setAnchorDate((d) => subWeeks(d, 1));
    else setAnchorDate((d) => subMonths(d, 1));
  };
  const goNext = () => {
    if (period === "day") setAnchorDate((d) => addDays(d, 1));
    else if (period === "week") setAnchorDate((d) => addWeeks(d, 1));
    else setAnchorDate((d) => addMonths(d, 1));
  };
  const goToday = () => setAnchorDate(new Date());

  const rangeLabel =
    period === "day"
      ? format(anchorDate, "EEEE d MMMM yyyy", { locale: fr })
      : period === "week"
        ? `${format(weekDays[0], "d MMMM", { locale: fr })} – ${format(weekDays[6], "d MMMM yyyy", { locale: fr })}`
        : format(anchorDate, "MMMM yyyy", { locale: fr });

  const handleSlotDoubleClick = (day: Date, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const hour = HOUR_START + offsetY / PX_PER_HOUR;
    const start = new Date(day);
    start.setHours(Math.floor(hour), hour % 1 >= 0.5 ? 30 : 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    setNewSlot({ start, end });
    setEditingInternal("new");
  };

  const handleMonthCellDoubleClick = (day: Date) => {
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    setNewSlot({ start, end });
    setEditingInternal("new");
  };

  return (
    <div className="flex h-full gap-3">
      <CalendarSidebar
        anchorDate={anchorDate}
        onSelectDay={(day) => {
          setAnchorDate(day);
          setViewMode("day");
        }}
        hiddenOrgs={hiddenOrgs}
        onToggleOrg={toggleOrgVisibility}
        mineOnly={mineOnly}
        onToggleMine={() => setMineOnly(!mineOnly)}
        plannedLabel={plannedLabel}
        availabilityPct={availabilityPct}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        onCreateEvent={() => {
          setNewSlot(null);
          setEditingInternal("new");
        }}
        accounts={accounts}
        googleAccountId={googleAccountId}
        onGoogleAccountChange={setGoogleAccountId}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {sidebarCollapsed && (
            <>
              <button
                onClick={toggleSidebarCollapsed}
                className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
                aria-label="Ouvrir la barre latérale"
                title="Ouvrir la barre latérale"
              >
                <PanelLeftOpen size={15} />
              </button>
              <button
                onClick={() => {
                  setNewSlot(null);
                  setEditingInternal("new");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-btn bg-navy text-white hover:bg-navy-600"
                aria-label="Nouvel événement"
              >
                <Plus size={15} />
              </button>
            </>
          )}
          <button
            onClick={goPrev}
            className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
            aria-label="Période précédente"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={goToday}
            className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
          >
            Aujourd&rsquo;hui
          </button>
          <button
            onClick={goNext}
            className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
            aria-label="Période suivante"
          >
            <ChevronRight size={14} />
          </button>
          <div className="ml-2 text-sm font-semibold capitalize text-ink-2">{rangeLabel}</div>
          <div className="ml-3 hidden text-xs text-ink-4 lg:block">
            Double-cliquez sur une plage ou un événement
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-[200px] items-center gap-2 rounded-btn border border-line bg-card px-3 py-1.5">
            <Search size={13} className="shrink-0 text-ink-4" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un événement..."
              className="w-full bg-transparent text-sm outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-ink-4 hover:text-ink">
                <X size={13} />
              </button>
            )}
          </div>
          <button
            onClick={() => setMineOnly(!mineOnly)}
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-btn border ${
              mineOnly ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:bg-hover"
            }`}
            title={mineOnly ? "Où je suis sollicité — afficher tous les événements" : "Tous les événements — n'afficher que ceux où je suis sollicité"}
            aria-label="Événements où je suis sollicité"
            aria-pressed={mineOnly}
          >
            <User size={15} />
          </button>
          <CoverageToggle
            icon={Video}
            label="en vidéo"
            on={coverage.video}
            isDefault={coverageDefaults.video}
            onToggle={() => setCoverage({ ...coverage, video: !coverage.video })}
            onSetDefault={(on) => setCoverageDefault("video", on)}
          />
          <CoverageToggle
            icon={Camera}
            label="en photo"
            on={coverage.photo}
            isDefault={coverageDefaults.photo}
            onToggle={() => setCoverage({ ...coverage, photo: !coverage.photo })}
            onSetDefault={(on) => setCoverageDefault("photo", on)}
          />

          <div className="flex items-center gap-0.5 rounded-btn border border-line bg-card p-0.5">
            {VIEW_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setViewMode(m.id)}
                className={`rounded-[6px] px-2.5 py-1.5 text-xs font-semibold ${
                  viewMode === m.id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {viewMode === "map" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-3">Afficher les événements du</span>
            <div className="flex items-center gap-0.5 rounded-btn border border-line bg-card p-0.5">
              {(
                [
                  { id: "month", label: "Mois" },
                  { id: "week", label: "Semaine" },
                  { id: "day", label: "Jour" },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setMapPeriod(p.id)}
                  className={`rounded-[6px] px-2.5 py-1 text-xs font-semibold ${
                    mapPeriod === p.id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <StaffEventsMap
            sidebar
            events={visibleEvents.filter((e) => !e.onlineMeeting)}
            onOpenEvent={(id) => {
              const ev = visibleEvents.find((e) => e.id === id);
              if (ev) setEditingInternal(ev);
            }}
            className="flex-1"
          />
        </div>
      ) :viewMode !== "month" ? (
        <div className="flex flex-1 overflow-hidden rounded-panel border border-line bg-card">
          <div className="w-12 shrink-0 border-r border-line pt-8">
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
              <div key={i} style={{ height: PX_PER_HOUR }} className="pr-2 text-right font-mono text-[10px] text-ink-4">
                {HOUR_START + i}h
              </div>
            ))}
          </div>

          <div
            className="grid flex-1 overflow-y-auto"
            style={{ gridTemplateColumns: `repeat(${displayDays.length}, minmax(0, 1fr))` }}
          >
            {displayDays.map((day) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              const isToday = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className="flex flex-col border-r border-line last:border-r-0">
                  <div className={`sticky top-0 z-[1] border-b border-line px-2 py-1.5 text-center ${isToday ? "bg-navy text-white" : "bg-card"}`}>
                    <div className="text-[10px] font-mono uppercase tracking-[0.1em] opacity-80">
                      {format(day, "EEE", { locale: fr })}
                    </div>
                    <div className="text-sm font-bold">{format(day, "d")}</div>
                    <div className="flex h-3.5 justify-center">
                      <DayWeatherBadge day={day} forecast={forecast} />
                    </div>
                  </div>

                  <div
                    className={`relative ${isWeekend ? "bg-subtle/40" : ""}`}
                    style={{ height: GRID_HEIGHT }}
                    onDoubleClick={(e) => handleSlotDoubleClick(day, e)}
                  >
                    {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                      <div key={i} className="border-b border-line/60" style={{ height: PX_PER_HOUR }} />
                    ))}

                    {isToday && showNowLine && (
                      <div className="absolute left-0 right-0 z-[1] border-t-2 border-red" style={{ top: nowTop }} />
                    )}

                    {eventsForDay(day).map((ev) => {
                      const { top, height } = blockStyle(ev.start, ev.end);
                      const color = ORG_COLORS[ev.org];
                      return (
                        <button
                          key={ev.id}
                          onClick={() => setEditingInternal(ev)}
                          className={`absolute left-0.5 right-0.5 overflow-hidden rounded-chip border-l-4 px-1.5 py-1 text-left shadow-sm ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                          style={{ top, height, background: color.bg, borderLeftColor: color.base }}
                        >
                          <div className="flex items-center gap-1">
                            <span className="truncate text-[11.5px] font-bold" style={{ color: color.ink }}>
                              {ev.title}
                            </span>
                            <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
                            <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                          </div>
                          <div className="font-mono text-[10px]" style={{ color: color.ink }}>
                            {format(parseISO(ev.start), "HH:mm")}
                          </div>
                        </button>
                      );
                    })}

                    {googleEventsForDay(day).map((ev) => {
                      const { top, height } = blockStyle(ev.start, ev.end);
                      return (
                        <button
                          key={`g-${ev.id}`}
                          onClick={() => setEditingGoogle(ev)}
                          className="absolute left-0.5 right-0.5 overflow-hidden rounded-chip border border-dashed border-line-strong bg-card/90 px-1.5 py-1 text-left"
                          style={{ top, height }}
                          title={`Google — ${ev.summary}`}
                        >
                          <div className="truncate text-[11px] font-semibold text-ink-2">G · {ev.summary}</div>
                          <div className="font-mono text-[10px] text-ink-4">{format(parseISO(ev.start), "HH:mm")}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
          <div className="grid grid-cols-7 border-b border-line">
            {weekDays.map((d) => (
              <div
                key={d.toISOString()}
                className="border-r border-line px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-4 last:border-r-0"
              >
                {format(d, "EEE", { locale: fr })}
              </div>
            ))}
          </div>

          <div
            className="grid flex-1 grid-cols-7 overflow-y-auto"
            style={{ gridTemplateRows: `repeat(${monthGridDays.length / 7}, minmax(96px, auto))` }}
          >
            {monthGridDays.map((day) => {
              const isToday = isSameDay(day, new Date());
              const inMonth = isSameMonth(day, anchorDate);
              const dayEvents = eventsForDay(day);
              const dayGoogleEvents = googleEventsForDay(day);

              return (
                <div
                  key={day.toISOString()}
                  onDoubleClick={() => handleMonthCellDoubleClick(day)}
                  className={`relative flex flex-col gap-1 border-b border-r border-line p-1.5 last:border-r-0 ${
                    inMonth ? "" : "bg-subtle/40"
                  }`}
                >
                  <button
                    onClick={() => {
                      setViewMode("day");
                      setAnchorDate(day);
                    }}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-xs font-bold ${
                      isToday ? "bg-navy text-white" : inMonth ? "text-ink-2 hover:bg-hover" : "text-ink-4"
                    }`}
                  >
                    {format(day, "d")}
                  </button>
                  {inMonth && (
                    <span className="pointer-events-none absolute right-1.5 top-2 text-ink-3">
                      <DayWeatherBadge day={day} forecast={forecast} />
                    </span>
                  )}

                  <div className="flex flex-col gap-0.5">
                    {dayEvents.map((ev) => {
                      const color = ORG_COLORS[ev.org];
                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingInternal(ev);
                          }}
                          className={`flex items-center gap-1 rounded-[4px] border-l-2 px-1 py-0.5 text-left text-[10px] font-semibold ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                          style={{ background: color.bg, borderLeftColor: color.base, color: color.ink }}
                        >
                          <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                          <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
                            <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                        </button>
                      );
                    })}
                    {dayGoogleEvents.map((ev) => (
                      <button
                        key={`g-${ev.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGoogle(ev);
                        }}
                        className="truncate rounded-[4px] border border-dashed border-line-strong px-1 py-0.5 text-left text-[10px] text-ink-3"
                      >
                        G · {ev.summary}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      {editingInternal && (
        <EventModal
          event={editingInternal === "new" ? null : editingInternal}
          defaultStart={newSlot?.start}
          defaultEnd={newSlot?.end}
          onClose={() => {
            setEditingInternal(null);
            setNewSlot(null);
          }}
          onSaved={refetch}
        />
      )}

      {editingGoogle && googleAccountId && (
        <GoogleEventModal
          accountId={googleAccountId}
          calendarId={googleCalendarId}
          event={editingGoogle === "new" ? null : editingGoogle}
          onClose={() => {
            setEditingGoogle(null);
            refetchGoogleEvents();
          }}
        />
      )}
    </div>
  );
}
