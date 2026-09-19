"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
  Camera,
  X,
  Plus,
} from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { fr } from "date-fns/locale";
import { useCalendarEvents } from "@/hooks/board/useCalendarEvents";
import { CALENDAR_ORG_KEYS } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS, type OrgKey } from "@/lib/board/tokens";
import type { CalendarEvent } from "@/lib/board/calendar";
import { MobileEventModal } from "@/components/board/mobile/MobileEventModal";
import { useAuth } from "@/contexts/AuthContext";

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
        <button
          onClick={() => setView((v) => (v === "mois" ? "semaine" : "mois"))}
          className="rounded-full border border-line px-3 py-1 text-[11px] font-bold text-ink-2"
        >
          {view === "mois" ? "Semaine" : "Mois"}
        </button>
      </div>

      <div className="flex h-[30px] items-center gap-2 px-4">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className={`flex h-6 w-6 items-center justify-center rounded-full text-white transition-transform ${
            anyFilterActive ? "bg-red" : "bg-navy"
          }`}
          style={{ transform: filtersOpen ? "rotate(180deg)" : undefined }}
        >
          <ChevronDown size={13} />
        </button>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
            mineOnly ? "bg-navy text-white" : "bg-subtle text-ink-3"
          }`}
        >
          <User size={11} /> Mes événements
        </button>
        <button
          onClick={() => setCoveredOnly((v) => !v)}
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
            coveredOnly ? "bg-navy text-white" : "bg-subtle text-ink-3"
          }`}
        >
          <Camera size={11} /> Couverts
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            setOrgFilter(null);
            setMineOnly(false);
            setCoveredOnly(false);
          }}
          className="text-[10px] font-bold text-ink-4"
        >
          {anyFilterActive ? "Tous" : "Filtré"}
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
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="grid grid-cols-7 px-2 pb-1">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <div key={i} className="text-center font-mono text-[9px] uppercase text-ink-4">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const dayEvents = eventsForDay(day);
              const inMonth = isSameMonth(day, anchor);
              const isToday = isSameDay(day, new Date());
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(day)}
                  className={`flex min-h-[52px] flex-col gap-0.5 rounded-btn border p-1 text-left ${
                    inMonth ? "border-line bg-card" : "border-transparent bg-transparent opacity-40"
                  }`}
                >
                  <span
                    className={`self-start rounded-full px-1 text-[10px] font-bold ${
                      isToday ? "bg-red text-white" : "text-ink-2"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <span
                      key={ev.id}
                      className="truncate rounded-[3px] border-l-2 pl-1 text-[8px] font-bold"
                      style={{ borderLeftColor: ORG_COLORS[ev.org].base, color: ORG_COLORS[ev.org].ink }}
                    >
                      {ev.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[8px] font-bold text-ink-4">+{dayEvents.length - 3}</span>
                  )}
                </button>
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

      {selectedDay && (
        <DayPanel
          day={selectedDay}
          events={eventsForDay(selectedDay)}
          onClose={() => setSelectedDay(null)}
          onOpenEvent={(ev) => setEditing(ev)}
          onCreate={() => setEditing("new")}
        />
      )}

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
  day,
  events,
  onClose,
  onOpenEvent,
  onCreate,
}: {
  day: Date;
  events: CalendarEvent[];
  onClose: () => void;
  onOpenEvent: (ev: CalendarEvent) => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="w-[52px] bg-black/20" onClick={onClose} aria-label="Fermer" />
      <div className="flex h-full w-[calc(100%-52px)] max-w-sm flex-col rounded-l-sheet bg-card shadow-modal">
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
              <div className="font-mono text-[10px]" style={{ color: ORG_COLORS[ev.org].ink }}>
                {format(parseISO(ev.start), "HH:mm")}
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
