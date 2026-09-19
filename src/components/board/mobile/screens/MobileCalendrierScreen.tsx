"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
  Camera,
  Video,
  Clock,
  Ban,
  List,
  X,
  Plus,
} from "lucide-react";
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
import { CALENDAR_ORG_KEYS } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, COVERAGE_COLORS, type CoverageState, type OrgKey } from "@/lib/board/tokens";
import type { CalendarEvent } from "@/lib/board/calendar";
import { MobileEventModal } from "@/components/board/mobile/MobileEventModal";
import { useAuth } from "@/contexts/AuthContext";

const COVERAGE_ICONS: Record<CoverageState, typeof Camera> = {
  photo: Camera,
  video: Video,
  both: Camera,
  wait: Clock,
  no: Ban,
};

function CoverageIcon({ state, size = 9 }: { state: CoverageState; size?: number }) {
  const Icon = COVERAGE_ICONS[state];
  return <Icon size={size} className="shrink-0" style={{ color: COVERAGE_COLORS[state].ink }} />;
}

type View = "mois" | "semaine";

export function MobileCalendrierScreen() {
  const { user } = useAuth();
  const [view, setView] = useState<View>("mois");
  const [anchor, setAnchor] = useState(() => new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orgFilter, setOrgFilter] = useState<OrgKey | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [coveredOnly, setCoveredOnly] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);

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
      if (mineOnly && e.createdBy !== user?.id) return false;
      if (coveredOnly && !(e.coverage === "photo" || e.coverage === "video" || e.coverage === "both")) return false;
      return true;
    });
  }, [events, orgFilter, mineOnly, coveredOnly, user?.id]);

  const eventsForDay = (day: Date) =>
    filtered.filter((e) => isSameDay(parseISO(e.start), day)).sort((a, b) => a.start.localeCompare(b.start));

  // Un événement est "multi-jours" s'il s'étend sur plus d'une journée calendaire
  // locale (ex: BMF Apprentissage sur 4-5 jours) — rendu en bandeau plutôt qu'en
  // puce dans une seule case, comme dans le prototype (§6.4 du handoff).
  const isMultiDay = (e: CalendarEvent) =>
    differenceInCalendarDays(startOfDay(parseISO(e.end)), startOfDay(parseISO(e.start))) >= 1;

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
        const colEnd = Math.min(6, differenceInCalendarDays(startOfDay(parseISO(e.end)), weekStart));
        return { event: e, colStart, colEnd };
      });
  };

  const orgCounts = useMemo(() => {
    const counts: Partial<Record<OrgKey, number>> = {};
    for (const e of events) counts[e.org] = (counts[e.org] ?? 0) + 1;
    return counts;
  }, [events]);

  const navPrev = () => setAnchor((a) => (view === "mois" ? subMonths(a, 1) : subWeeks(a, 1)));
  const navNext = () => setAnchor((a) => (view === "mois" ? addMonths(a, 1) : addWeeks(a, 1)));

  const anyFilterActive = !!orgFilter || mineOnly || coveredOnly;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-1">
          <button onClick={navPrev} className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3">
            <ChevronLeft size={16} />
          </button>
          <span className="whitespace-nowrap text-[13px] font-bold text-ink">
            {format(anchor, view === "mois" ? "MMMM yyyy" : "'Sem.' I, MMMM", { locale: fr })}
          </span>
          <button onClick={navNext} className="flex h-7 w-7 items-center justify-center rounded-btn text-ink-3">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-0.5 rounded-full border border-line bg-subtle p-0.5">
          {(["semaine", "mois"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold capitalize transition-colors ${
                view === v ? "bg-card text-ink shadow-card" : "text-ink-3"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex h-[30px] items-center gap-2 px-4">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] bg-card transition-transform"
          style={{
            borderColor: filtersOpen ? "var(--red)" : "var(--navy-600)",
            color: filtersOpen ? "var(--red)" : "var(--navy-600)",
            transform: filtersOpen ? "rotate(180deg)" : undefined,
          }}
        >
          <ChevronDown size={15} />
        </button>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={`flex h-[30px] w-[30px] items-center justify-center rounded-btn border ${
            mineOnly ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3"
          }`}
          title="Mes événements"
        >
          <User size={15} />
        </button>
        <button
          onClick={() => setCoveredOnly((v) => !v)}
          className={`flex h-[30px] w-[30px] items-center justify-center rounded-btn border ${
            coveredOnly ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3"
          }`}
          title="Couverts"
        >
          <Camera size={15} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            setOrgFilter(null);
            setMineOnly(false);
            setCoveredOnly(false);
          }}
          className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-2.5 py-1.5 text-ink-2"
        >
          <List size={14} />
          <span className="text-[11.5px] font-semibold">{anyFilterActive ? "Filtré" : "Tous"}</span>
        </button>
      </div>

      {filtersOpen && (
        <div className="grid grid-cols-5 gap-1.5 px-4 pb-2 pt-1">
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
        <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-7 px-1 pb-1">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <div key={i} className="text-center font-mono text-[9px] uppercase text-ink-4">
                {d}
              </div>
            ))}
          </div>
          <div className="flex flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
            {weeks.map((week, weekIdx) => {
              const banners = bannersForWeek(week);
              return (
                <div
                  key={week[0].toISOString()}
                  className={`grid flex-1 grid-cols-7 ${weekIdx > 0 ? "border-t border-line" : ""}`}
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
                        className={`flex h-full min-h-[52px] flex-col gap-0.5 p-1 text-left ${
                          dayIdx > 0 ? "border-l border-line" : ""
                        } ${inMonth ? "bg-card" : "bg-subtle/40 opacity-50"}`}
                      >
                        <span
                          className={`self-start rounded-full px-1 text-[10px] font-bold ${
                            isToday ? "bg-red text-white" : "text-ink-2"
                          }`}
                        >
                          {format(day, "d")}
                        </span>
                        {dayEvents.map((ev) => (
                          <span
                            key={ev.id}
                            className="flex shrink-0 items-center gap-0.5 overflow-hidden rounded-[4px] pr-0.5"
                            style={{ background: ORG_COLORS[ev.org].bg, height: 15 }}
                          >
                            <span className="h-full w-[3px] shrink-0" style={{ background: ORG_COLORS[ev.org].base }} />
                            <span
                              className="min-w-0 flex-1 truncate text-[8px] font-bold"
                              style={{ color: ORG_COLORS[ev.org].ink }}
                            >
                              {ev.title}
                            </span>
                            {ev.coverage && <CoverageIcon state={ev.coverage} />}
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
                      {ev.coverage && <CoverageIcon state={ev.coverage} size={10} />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-2">
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
                </div>
                <div className="flex-1 space-y-1">
                  {dayEvents.length === 0 && <div className="text-xs text-ink-4">Aucun événement</div>}
                  {dayEvents.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-1.5 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: ORG_COLORS[ev.org].base }} />
                      <span className="font-mono text-[10px] text-ink-4">{format(parseISO(ev.start), "HH:mm")}</span>
                      <span className="truncate font-semibold text-ink-2">{ev.title}</span>
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

      <DayPanel
        open={!!selectedDay}
        day={selectedDay ?? new Date()}
        events={selectedDay ? eventsForDay(selectedDay) : []}
        onClose={() => setSelectedDay(null)}
        onOpenEvent={(ev) => setEditing(ev)}
        onCreate={() => setEditing("new")}
      />

      {editing && (
        <MobileEventModal
          event={editing === "new" ? null : editing}
          defaultStart={selectedDay ?? undefined}
          onClose={() => setEditing(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

function DayPanel({
  open,
  day,
  events,
  onClose,
  onOpenEvent,
  onCreate,
}: {
  open: boolean;
  day: Date;
  events: CalendarEvent[];
  onClose: () => void;
  onOpenEvent: (ev: CalendarEvent) => void;
  onCreate: () => void;
}) {
  return (
    <div
      className={`fixed inset-0 z-40 flex justify-end transition-opacity duration-300 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button className="w-[52px] bg-black/20" onClick={onClose} aria-label="Fermer" tabIndex={open ? 0 : -1} />
      <div
        className={`flex h-full w-[calc(100%-52px)] max-w-sm flex-col rounded-l-sheet bg-card shadow-modal transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-mono text-[10px] text-ink-4">{events.length} événement{events.length > 1 ? "s" : ""}</div>
            <div className="text-sm font-extrabold text-ink">{format(day, "EEEE d MMMM yyyy", { locale: fr })}</div>
          </div>
          <button onClick={onClose} className="text-ink-4">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {events.length === 0 && (
            <div className="rounded-btn border border-dashed border-line p-4 text-center text-xs text-ink-4">
              Aucun événement ce jour-là.
            </div>
          )}
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => onOpenEvent(ev)}
              className="block w-full rounded-btn px-3 py-2 text-left"
              style={{ background: ORG_COLORS[ev.org].bg }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px]" style={{ color: ORG_COLORS[ev.org].ink }}>
                  {format(parseISO(ev.start), "HH:mm")}
                </span>
                {ev.coverage && <CoverageIcon state={ev.coverage} size={13} />}
              </div>
              <div className="text-sm font-bold" style={{ color: ORG_COLORS[ev.org].ink }}>
                {ev.title}
              </div>
            </button>
          ))}
          <button
            onClick={onCreate}
            className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-dashed border-line py-2.5 text-xs font-semibold text-ink-3"
          >
            <Plus size={13} /> Nouvel événement
          </button>
        </div>
      </div>
    </div>
  );
}
