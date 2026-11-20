"use client";

import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { DirectorGlyph } from "@/components/board/calendar/DirectorGlyph";
import { CoverageToggle } from "@/components/board/calendar/CoverageToggle";
import { TeamCardGlyph, useEventTeamCards } from "@/components/board/team/TeamCardOpener";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, User, X, PanelLeftOpen, Camera, Video, Mic } from "lucide-react";
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
import { useCalendarDefaults, type CalendarView } from "@/hooks/board/useCalendarDefaults";
import { DefaultMenu } from "@/components/board/calendar/DefaultMenu";
import { DayWeatherBadge, useForecast } from "@/components/board/calendar/DayWeather";
import { CoverageGlyph } from "@/components/board/calendar/CoverageGlyph";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { listMyCalendars, listMyEvents } from "@/app/actions/calendar";
import { reconcileGoogleMirrors } from "@/app/actions/calendar-sync";
import { EventModal } from "@/components/board/calendar/EventModal";
import { VoiceEventDialog } from "@/components/board/calendar/VoiceEvent";
import type { EventDraft } from "@/app/actions/event-dictation";
import { GoogleEventModal } from "@/components/board/calendar/GoogleEventModal";
import { ORG_COLORS, type OrgKey } from "@/lib/board/tokens";
import { CalendarSidebar } from "@/components/board/calendar/CalendarSidebar";
import { StaffEventsMap } from "@/components/board/calendar/StaffEventsMap";
import { DayDrawer } from "@/components/board/calendar/DayDrawer";
import { isMultiDayEvent, isMyEvent, layoutBanners, layoutOverlaps, type CalendarEvent } from "@/lib/board/calendar";
import { useMyTravelTimes } from "@/hooks/board/useMyTravelTimes";
import { departureTime, formatTravel } from "@/lib/board/geo";

// Plage horaire affichée par défaut ; elle s'élargit d'elle-même pour qu'aucun événement (match à
// 20 h 30, départ à 7 h) ne sorte de la grille.
const HOUR_START = 8;
const HOUR_END = 20;
const PX_PER_HOUR = 56;
const MIN_BLOCK_H = 40;
const DAY_HEADER_H = 56;
const WEEK_OPTS = { weekStartsOn: 1 as const, locale: fr };

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type GoogleEventItem = Awaited<ReturnType<typeof listMyEvents>>[number];
type ViewMode = CalendarView;

function hourFloat(iso: string) {
  const d = parseISO(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** Heure de fin sur l'échelle du jour de début : une fin le lendemain (minuit pile compris) vaut 24 h. */
function endHourFloat(startISO: string, endISO: string) {
  return isSameDay(parseISO(startISO), parseISO(endISO)) ? hourFloat(endISO) : 24;
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
  { id: "map", label: "Carte" },
];

export function CalendrierScreen() {
  // Vue par défaut (clic droit sur les vues) : celle du compte, reprise sur le mobile ; le clic simple vaut pour la session.
  const [calendarDefaults, setCalendarDefault] = useCalendarDefaults();
  const [viewOverride, setViewMode] = useState<ViewMode | null>(null);
  const viewMode = viewOverride ?? calendarDefaults.view;
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
  // Journée ouverte en panneau latéral (clic sur un jour en vue Mois / Semaine).
  const [drawerDay, setDrawerDay] = useState<Date | null>(null);
  const [newSlot, setNewSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editingGoogle, setEditingGoogle] = useState<GoogleEventItem | "new" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenOrgs, setHiddenOrgs] = useState<Set<OrgKey>>(() => new Set());
  const [mineOnly, setMineOnly, mineDefault, setMineDefault] = useSolicitedFilter();
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
      .then(async (items) => {
        // Copies Google des événements du board : masquées (déjà affichées en vrai) ou, si
        // l'événement a disparu, supprimées de Google. Seul ce qui a été créé dans Google reste.
        const sorted = await reconcileGoogleMirrors(
          googleAccountId,
          items.map((e) => ({ googleEventId: e.id, calendarId: e.calendarId, boardEventId: e.boardEventId }))
        ).catch(() => null);
        const drop = new Set([...(sorted?.hidden ?? []), ...(sorted?.removed ?? [])]);
        setGoogleEvents(items.filter((e) => !drop.has(e.id)));
      })
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
      if (mineOnly && !isMyEvent(e)) return false;
      if (!passesCoverageFilters(e, coverage)) return false;
      if (hiddenOrgs.has(e.org)) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, searchQuery, hiddenOrgs, mineOnly, coverage]);

  // Panneau de la journée : tout ce qui touche ce jour, bandeaux de plusieurs jours compris.
  const drawerEvents = useMemo(() => {
    if (!drawerDay) return [];
    const from = startOfDay(drawerDay).getTime();
    const to = endOfDay(drawerDay).getTime();
    return visibleEvents.filter((e) => parseISO(e.start).getTime() <= to && parseISO(e.end).getTime() > from);
  }, [drawerDay, visibleEvents]);
  const teamCards = useEventTeamCards(visibleEvents.map((e) => e.id));
  // Temps de route depuis le domicile (événements où je suis sollicité) : bloc « départ » en pointillé.
  // Aussi pour le panneau de la journée (vue Mois comprise). Seulement mes propres trajets : calculés
  // côté serveur depuis mon adresse, pour les événements où je suis sollicité.
  const myTravel = useMyTravelTimes(viewMode === "day" || viewMode === "week" ? visibleEvents : drawerEvents);
  // Google Maps préchargé : la mini-carte d'itinéraire de la fiche s'affiche sans attendre le script.
  useGoogleMapsScript();
  // Les événements de plusieurs jours sont en bandeaux (layoutBanners), pas dans la case de leur premier jour.
  const eventsForDay = (day: Date) => visibleEvents.filter((e) => !isMultiDayEvent(e) && isSameDay(parseISO(e.start), day));
  const monthWeeks = useMemo(() => {
    const weeks: Date[][] = [];
    for (let i = 0; i < monthGridDays.length; i += 7) weeks.push(monthGridDays.slice(i, i + 7));
    return weeks;
  }, [monthGridDays]);
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

  // Grille horaire : 8 h – 20 h, élargie au plus tôt / plus tard des événements affichés.
  const { hourStart, hourEnd } = useMemo(() => {
    let lo = HOUR_START;
    let hi = HOUR_END;
    if (viewMode === "day" || viewMode === "week") {
      const inRange = (iso: string) => displayDays.some((d) => isSameDay(parseISO(iso), d));
      const spans = [
        ...visibleEvents.filter((e) => !isMultiDayEvent(e) && inRange(e.start)),
        ...googleEvents.filter((e) => !e.allDay && inRange(e.start)),
      ];
      for (const e of spans) {
        lo = Math.min(lo, Math.floor(hourFloat(e.start)));
        hi = Math.max(hi, Math.ceil(endHourFloat(e.start, e.end)), Math.ceil(hourFloat(e.start) + MIN_BLOCK_H / PX_PER_HOUR));
      }
    }
    return { hourStart: Math.max(0, lo), hourEnd: Math.min(24, hi) };
  }, [viewMode, displayDays, visibleEvents, googleEvents]);
  const gridHeight = (hourEnd - hourStart) * PX_PER_HOUR;

  const blockStyle = (startISO: string, endISO: string) => {
    const top = Math.max(0, (hourFloat(startISO) - hourStart) * PX_PER_HOUR);
    const height = Math.max(MIN_BLOCK_H, (endHourFloat(startISO, endISO) - hourFloat(startISO)) * PX_PER_HOUR - 4);
    return { top, height: Math.min(height, gridHeight - top) };
  };
  const blockSpan = (startISO: string, endISO: string) => {
    const { top, height } = blockStyle(startISO, endISO);
    return { top, bottom: top + height };
  };

  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60 - hourStart) * PX_PER_HOUR;
  const showNowLine = nowTop >= 0 && nowTop <= gridHeight;

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
    const hour = hourStart + offsetY / PX_PER_HOUR;
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

  const closeDrawer = useCallback(() => setDrawerDay(null), []);
  const shiftDrawerDay = useCallback(
    (delta: number) =>
      setDrawerDay((d) => {
        if (!d) return d;
        const next = addDays(d, delta);
        // Hors de la période chargée : le calendrier suit (mois ou semaine voisins).
        if (next < rangeStart || next > rangeEnd) setAnchorDate(next);
        return next;
      }),
    [rangeStart, rangeEnd]
  );

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
        onVoiceEvent={() => setVoiceOpen(true)}
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
              <button
                onClick={() => setVoiceOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-navy hover:bg-hover"
                aria-label="Créer un événement à la voix"
                title="Créer un événement à la voix"
              >
                <Mic size={15} />
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
          <DefaultMenu
            title="Où je suis sollicité"
            options={[
              { label: "Tous les événements par défaut", selected: !mineDefault, onSelect: () => setMineDefault(false) },
              { label: "Seulement où je suis sollicité", selected: mineDefault, onSelect: () => setMineDefault(true) },
            ]}
          >
            {(onContextMenu) => (
              <button
                onClick={() => setMineOnly(!mineOnly)}
                onContextMenu={onContextMenu}
                className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-btn border ${
                  mineOnly ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:bg-hover"
                }`}
                title={`${mineOnly ? "Où je suis sollicité — afficher tous les événements" : "Tous les événements — n'afficher que ceux où je suis sollicité"} · clic droit : affichage par défaut`}
                aria-label="Événements où je suis sollicité"
                aria-pressed={mineOnly}
              >
                <User size={15} />
              </button>
            )}
          </DefaultMenu>
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

          <DefaultMenu
            title="Vue par défaut"
            options={VIEW_MODES.map((m) => ({ label: m.label, selected: calendarDefaults.view === m.id, onSelect: () => setCalendarDefault("view", m.id) }))}
            footnote="Sur mobile : Jour s'ouvre en Semaine, Carte en Mois. Le clic simple change la vue pour cette session seulement."
          >
            {(onContextMenu) => (
              <div className="flex items-center gap-0.5 rounded-btn border border-line bg-card p-0.5" onContextMenu={onContextMenu}>
                {VIEW_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setViewMode(m.id)}
                    title={`${m.label}${calendarDefaults.view === m.id ? " (vue par défaut)" : ""} · clic droit : vue par défaut`}
                    className={`rounded-[6px] px-2.5 py-1.5 text-xs font-semibold ${
                      viewMode === m.id ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </DefaultMenu>
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
      ) : viewMode !== "month" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
          {/* Événements de plusieurs jours : bandeaux au-dessus de la grille horaire. */}
          {(() => {
            const banners = layoutBanners(visibleEvents, displayDays);
            if (banners.length === 0) return null;
            const laneCount = banners.reduce((n, b) => Math.max(n, b.lane + 1), 0);
            const rangeEnd = addDays(displayDays[displayDays.length - 1], 1);
            return (
              <div className="flex max-h-[30%] shrink-0 overflow-y-auto border-b border-line bg-subtle/40">
                <div className="flex w-12 shrink-0 items-center justify-end border-r border-line pr-1.5 text-right font-mono text-[9px] leading-tight text-ink-4">
                  Plusieurs
                  <br />
                  jours
                </div>
                <div
                  className="grid flex-1 py-1"
                  style={{ gridTemplateColumns: `repeat(${displayDays.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${laneCount}, auto)` }}
                >
                  {banners.map(({ event: ev, colStart, colEnd, lane }) => {
                    const color = ORG_COLORS[ev.org];
                    const fromBefore = parseISO(ev.start) < displayDays[0];
                    const toAfter = new Date(parseISO(ev.end).getTime() - 1) >= rangeEnd;
                    return (
                      <button
                        key={ev.id}
                        onClick={() => setEditingInternal(ev)}
                        title={`${ev.title} — du ${format(parseISO(ev.start), "d MMM HH:mm", { locale: fr })} au ${format(parseISO(ev.end), "d MMM HH:mm", { locale: fr })}`}
                        className={`mx-0.5 my-px flex h-[22px] items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-bold ${
                          fromBefore ? "rounded-l-none" : "rounded-l-chip border-l-4"
                        } ${toAfter ? "rounded-r-none" : "rounded-r-chip"} ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                        style={{ gridColumn: `${colStart + 1} / ${colEnd + 2}`, gridRow: lane + 1, background: color.bg, borderLeftColor: color.base, color: color.ink }}
                      >
                        {fromBefore && <ChevronLeft size={11} className="shrink-0 opacity-70" />}
                        <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                        <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
                        <DirectorGlyph status={ev.director} size={10} />
                        <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                        {toAfter && <ChevronRight size={11} className="shrink-0 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Un seul défilement pour les heures et les jours : la colonne des heures reste alignée. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="flex min-w-0">
              <div className="w-12 shrink-0 border-r border-line">
                <div className="sticky top-0 z-[3] border-b border-line bg-card" style={{ height: DAY_HEADER_H }} />
                {Array.from({ length: hourEnd - hourStart }, (_, i) => (
                  <div key={i} style={{ height: PX_PER_HOUR }} className="pr-2 pt-0.5 text-right font-mono text-[10px] text-ink-4">
                    {hourStart + i}h
                  </div>
                ))}
              </div>

              <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${displayDays.length}, minmax(0, 1fr))` }}>
                {displayDays.map((day) => {
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const isToday = isSameDay(day, new Date());
                  const dayEvents = eventsForDay(day);
                  const dayGoogle = googleEventsForDay(day);
                  const positions = layoutOverlaps([
                    ...dayEvents.map((ev) => ({ key: `i:${ev.id}`, ...blockSpan(ev.start, ev.end) })),
                    ...dayGoogle.map((ev) => ({ key: `g:${ev.id}`, ...blockSpan(ev.start, ev.end) })),
                  ]);
                  // Largeur d'un bloc en part de la journée : sous un certain seuil, affichage resserré.
                  const narrow = (p: { cols: number; span: number }) => (p.span / p.cols) * (displayDays.length > 1 ? 1 : 7) < 0.6;
                  const placeStyle = (p: { col: number; cols: number; span: number }) => ({
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${(p.span / p.cols) * 100}% - ${p.col + p.span < p.cols ? 3 : 4}px)`,
                  });
                  const count = dayEvents.length + dayGoogle.length;
                  return (
                    <div key={day.toISOString()} className="flex min-w-0 flex-col border-r border-line last:border-r-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (viewMode !== "day") setDrawerDay(day);
                        }}
                        title={viewMode === "day" ? undefined : `Afficher la journée du ${format(day, "EEEE d MMMM", { locale: fr })}`}
                        className={`group sticky top-0 z-[2] flex flex-col items-center justify-center border-b border-line px-2 text-center ${
                          isToday ? "bg-navy text-white" : "bg-card"
                        } ${viewMode === "day" ? "cursor-default" : isToday ? "hover:bg-navy-600" : "hover:bg-hover"}`}
                        style={{ height: DAY_HEADER_H }}
                      >
                        <span className="text-[10px] font-mono uppercase tracking-[0.1em] opacity-80">
                          {format(day, "EEE", { locale: fr })}
                        </span>
                        <span className="flex items-center gap-1 text-sm font-bold">
                          {format(day, "d")}
                          {count > 0 && viewMode !== "day" && (
                            <span
                              className={`rounded-full px-1.5 text-[9px] font-bold leading-[14px] ${
                                isToday ? "bg-white/20 text-white" : "bg-subtle text-ink-3"
                              }`}
                            >
                              {count}
                            </span>
                          )}
                        </span>
                        <span className="flex h-3.5 justify-center">
                          <DayWeatherBadge day={day} forecast={forecast} />
                        </span>
                      </button>

                      <div
                        className={`relative ${isWeekend ? "bg-subtle/40" : ""}`}
                        style={{ height: gridHeight }}
                        onDoubleClick={(e) => handleSlotDoubleClick(day, e)}
                      >
                        {Array.from({ length: hourEnd - hourStart }, (_, i) => (
                          <div key={i} className="border-b border-line/60" style={{ height: PX_PER_HOUR }} />
                        ))}

                        {isToday && showNowLine && (
                          <div className="pointer-events-none absolute left-0 right-0 z-[4] border-t-2 border-red" style={{ top: nowTop }}>
                            <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red" />
                          </div>
                        )}

                        {dayEvents.map((ev) => {
                          const travel = myTravel[ev.id];
                          const pos = positions.get(`i:${ev.id}`);
                          if (!travel || !pos) return null;
                          const departure = departureTime(ev.start, travel.minutes);
                          const evTop = (hourFloat(ev.start) - hourStart) * PX_PER_HOUR;
                          const depTop = Math.max(0, evTop - ((parseISO(ev.start).getTime() - departure.getTime()) / 3_600_000) * PX_PER_HOUR);
                          const height = evTop - depTop - 2;
                          if (height < 6) return null;
                          const color = ORG_COLORS[ev.org];
                          return (
                            <div
                              key={`travel-${ev.id}`}
                              aria-hidden
                              className="pointer-events-none absolute overflow-hidden rounded-chip border-2 border-dashed px-1.5"
                              style={{ ...placeStyle(pos), top: depTop, height, borderColor: color.base, color: color.ink }}
                            >
                              {height >= 16 && !narrow(pos) && (
                                <div className="truncate font-mono text-[10px] font-semibold">
                                  Départ {format(departure, "HH:mm")} · {formatTravel(travel)}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {dayEvents.map((ev) => {
                          const pos = positions.get(`i:${ev.id}`);
                          if (!pos) return null;
                          const { top, height } = blockStyle(ev.start, ev.end);
                          const color = ORG_COLORS[ev.org];
                          const tight = narrow(pos);
                          return (
                            <button
                              key={ev.id}
                              onClick={() => setEditingInternal(ev)}
                              title={`${format(parseISO(ev.start), "HH:mm")}–${format(parseISO(ev.end), "HH:mm")} · ${ev.title}`}
                              className={`absolute z-[1] overflow-hidden rounded-chip border-l-[3px] text-left shadow-sm transition-shadow hover:z-[5] hover:shadow-card ${
                                tight ? "px-1 py-0.5" : "px-1.5 py-1"
                              } ${ev.awaitingMyAnswer ? "ring-2 ring-red" : "ring-1 ring-card"}`}
                              style={{ ...placeStyle(pos), top, height, background: color.bg, borderLeftColor: color.base, color: color.ink }}
                            >
                              <div className="font-mono text-[10px] leading-tight opacity-80">{format(parseISO(ev.start), "HH:mm")}</div>
                              <div
                                className={`font-bold leading-tight ${tight ? "text-[10.5px]" : "text-[11.5px]"}`}
                                style={{
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: Math.max(1, Math.floor((height - (tight ? 16 : 34)) / 14)),
                                  overflow: "hidden",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {ev.title}
                              </div>
                              {!tight && (
                                <div className="mt-0.5 flex items-center gap-1">
                                  <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
                                  <DirectorGlyph status={ev.director} size={10} />
                                  <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                                </div>
                              )}
                            </button>
                          );
                        })}

                        {dayGoogle.map((ev) => {
                          const pos = positions.get(`g:${ev.id}`);
                          if (!pos) return null;
                          const { top, height } = blockStyle(ev.start, ev.end);
                          return (
                            <button
                              key={`g-${ev.id}`}
                              onClick={() => setEditingGoogle(ev)}
                              className="absolute z-[1] overflow-hidden rounded-chip border border-dashed border-line-strong bg-card/95 px-1.5 py-1 text-left hover:z-[5] hover:shadow-card"
                              style={{ ...placeStyle(pos), top, height }}
                              title={`Google — ${format(parseISO(ev.start), "HH:mm")} · ${ev.summary}`}
                            >
                              <div className="font-mono text-[10px] leading-tight text-ink-4">{format(parseISO(ev.start), "HH:mm")}</div>
                              <div className="truncate text-[11px] font-semibold text-ink-2">G · {ev.summary}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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

          <div className="flex flex-1 flex-col overflow-y-auto">
            {monthWeeks.map((week) => {
              const banners = layoutBanners(visibleEvents, week);
              const laneCount = banners.reduce((n, b) => Math.max(n, b.lane + 1), 0);
              const weekEnd = addDays(week[6], 1);
              return (
                <div
                  key={week[0].toISOString()}
                  className="grid min-h-[104px] flex-[1_0_auto] grid-cols-7 border-b border-line"
                  style={{ gridTemplateRows: `auto ${laneCount ? `repeat(${laneCount}, auto) ` : ""}1fr` }}
                >
                  {/* Fond des cases (toute la hauteur de la semaine). */}
                  {week.map((day, i) => (
                    <div
                      key={`bg-${day.toISOString()}`}
                      onDoubleClick={() => handleMonthCellDoubleClick(day)}
                      className={`border-r border-line last:border-r-0 ${isSameMonth(day, anchorDate) ? "" : "bg-subtle/40"}`}
                      style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
                    />
                  ))}

                  {week.map((day, i) => {
                    const isToday = isSameDay(day, new Date());
                    const inMonth = isSameMonth(day, anchorDate);
                    const dayCount = eventsForDay(day).length + googleEventsForDay(day).length;
                    return (
                      // Toute la ligne d'en-tête de la case (numéro, météo, nombre d'événements) ouvre la journée :
                      // une cible large, facile à toucher même quand la case déborde d'événements.
                      <button
                        type="button"
                        key={`head-${day.toISOString()}`}
                        onClick={() => setDrawerDay(day)}
                        onDoubleClick={() => handleMonthCellDoubleClick(day)}
                        title={`Afficher la journée du ${format(day, "EEEE d MMMM", { locale: fr })}`}
                        className="group relative flex min-h-[32px] items-center justify-between gap-1 px-1.5 pt-1 text-left hover:bg-hover/70"
                        style={{ gridColumn: i + 1, gridRow: 1 }}
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold ${
                              isToday ? "bg-navy text-white" : inMonth ? "text-ink-2 group-hover:bg-card" : "text-ink-4"
                            }`}
                          >
                            {format(day, "d")}
                          </span>
                          {dayCount > 2 && (
                            <span className="rounded-full bg-subtle px-1.5 text-[9.5px] font-bold leading-4 text-ink-3 group-hover:bg-card">
                              {dayCount}
                            </span>
                          )}
                        </span>
                        {inMonth && (
                          <span className="pointer-events-none text-ink-3">
                            <DayWeatherBadge day={day} forecast={forecast} />
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Événements de plusieurs jours : un bandeau sur tous leurs jours, comme sur mobile. */}
                  {banners.map(({ event: ev, colStart, colEnd, lane }) => {
                    const color = ORG_COLORS[ev.org];
                    const fromBefore = parseISO(ev.start) < week[0];
                    const toAfter = new Date(parseISO(ev.end).getTime() - 1) >= weekEnd;
                    return (
                      <button
                        key={`banner-${ev.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingInternal(ev);
                        }}
                        title={`${ev.title} — du ${format(parseISO(ev.start), "d MMM HH:mm", { locale: fr })} au ${format(parseISO(ev.end), "d MMM HH:mm", { locale: fr })}`}
                        className={`relative mx-1 my-px flex h-[20px] items-center gap-1 overflow-hidden px-1.5 text-left text-[10px] font-semibold ${
                          fromBefore ? "rounded-l-none border-l-0" : "rounded-l-[4px] border-l-2"
                        } ${toAfter ? "rounded-r-none" : "rounded-r-[4px]"} ${ev.awaitingMyAnswer ? "ring-2 ring-red" : ""}`}
                        style={{
                          gridColumn: `${colStart + 1} / ${colEnd + 2}`,
                          gridRow: lane + 2,
                          background: color.bg,
                          borderLeftColor: color.base,
                          color: color.ink,
                          marginLeft: fromBefore ? 0 : undefined,
                          marginRight: toAfter ? 0 : undefined,
                        }}
                      >
                        {fromBefore && <ChevronLeft size={10} className="shrink-0 opacity-70" />}
                        <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                        <CoverageGlyph coverage={ev.coverage} published={ev.published} awaitingMe={ev.awaitingMyAnswer} size={10} />
<DirectorGlyph status={ev.director} size={10} />
                        <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                        {toAfter && <ChevronRight size={10} className="shrink-0 opacity-70" />}
                      </button>
                    );
                  })}

                  {week.map((day, i) => (
                    <div
                      key={`events-${day.toISOString()}`}
                      onDoubleClick={() => handleMonthCellDoubleClick(day)}
                      className="relative flex min-w-0 flex-col gap-0.5 px-1.5 pb-1.5 pt-0.5"
                      style={{ gridColumn: i + 1, gridRow: laneCount + 2 }}
                    >
                      {eventsForDay(day).map((ev) => {
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
<DirectorGlyph status={ev.director} size={10} />
                            <TeamCardGlyph cards={teamCards[ev.id]} size={10} color={color.ink} />
                          </button>
                        );
                      })}
                      {googleEventsForDay(day).map((ev) => (
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
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>

      <DayDrawer
        day={drawerDay}
        events={drawerEvents}
        googleEvents={drawerDay ? googleEventsForDay(drawerDay) : []}
        forecast={forecast}
        teamCards={teamCards}
        travel={myTravel}
        paused={!!editingInternal || !!editingGoogle || voiceOpen}
        onClose={closeDrawer}
        onShiftDay={shiftDrawerDay}
        onOpenEvent={(ev) => setEditingInternal(ev)}
        onOpenGoogle={(id) => {
          const g = googleEvents.find((e) => e.id === id);
          if (g) setEditingGoogle(g);
        }}
        onCreate={() => drawerDay && handleMonthCellDoubleClick(drawerDay)}
        onVoice={() => setVoiceOpen(true)}
        onOpenDayView={() => {
          if (!drawerDay) return;
          setAnchorDate(drawerDay);
          setViewMode("day");
          setDrawerDay(null);
        }}
      />

      {editingInternal && (
        <EventModal
          event={editingInternal === "new" ? null : editingInternal}
          defaultStart={newSlot?.start}
          defaultEnd={newSlot?.end}
          draft={editingInternal === "new" ? draft : null}
          onClose={() => {
            setEditingInternal(null);
            setNewSlot(null);
            setDraft(null);
          }}
          onSaved={refetch}
        />
      )}

      {voiceOpen && (
        <VoiceEventDialog
          onClose={() => setVoiceOpen(false)}
          onDraft={(d) => {
            setVoiceOpen(false);
            setDraft(d);
            setNewSlot(null);
            setEditingInternal("new");
          }}
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
