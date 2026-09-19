"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  Camera,
  Video,
  Clock,
  Ban,
} from "lucide-react";
import {
  addDays,
  addWeeks,
  endOfDay,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { fr } from "date-fns/locale";
import { useCalendarEvents } from "@/hooks/board/useCalendarEvents";
import { getMyConnectedAccounts } from "@/app/actions/connected-accounts";
import { listMyCalendars, listMyEvents } from "@/app/actions/calendar";
import { EventModal } from "@/components/board/calendar/EventModal";
import { GoogleEventModal } from "@/components/board/calendar/GoogleEventModal";
import { ORG_COLORS, COVERAGE_LABELS, COVERAGE_COLORS, type CoverageState } from "@/lib/board/tokens";
import type { CalendarEvent } from "@/lib/board/calendar";

const HOUR_START = 8;
const HOUR_END = 20;
const PX_PER_HOUR = 56;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;

type Account = Awaited<ReturnType<typeof getMyConnectedAccounts>>[number];
type GoogleEventItem = Awaited<ReturnType<typeof listMyEvents>>[number];

function hourFloat(iso: string) {
  const d = parseISO(iso);
  return d.getHours() + d.getMinutes() / 60;
}

function blockStyle(startISO: string, endISO: string) {
  const top = Math.max(0, (hourFloat(startISO) - HOUR_START) * PX_PER_HOUR);
  const height = Math.max(40, (hourFloat(endISO) - hourFloat(startISO)) * PX_PER_HOUR - 4);
  return { top, height: Math.min(height, GRID_HEIGHT - top) };
}

const COVERAGE_ICONS: Record<CoverageState, typeof Camera> = {
  photo: Camera,
  video: Video,
  both: Camera,
  wait: Clock,
  no: Ban,
};

export function CalendrierScreen() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1, locale: fr }));
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = useMemo(() => startOfDay(weekDays[0]), [weekDays]);
  const rangeEnd = useMemo(() => endOfDay(weekDays[6]), [weekDays]);

  const { events, refetch } = useCalendarEvents(rangeStart, rangeEnd);

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [googleAccountId, setGoogleAccountId] = useState<string | null>(null);
  const [googleCalendarId] = useState("primary");
  const [googleEvents, setGoogleEvents] = useState<GoogleEventItem[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);

  const [editingInternal, setEditingInternal] = useState<CalendarEvent | "new" | null>(null);
  const [newSlot, setNewSlot] = useState<{ start: Date; end: Date } | null>(null);
  const [editingGoogle, setEditingGoogle] = useState<GoogleEventItem | "new" | null>(null);

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
      setGoogleEvents([]);
      return;
    }
    refetchGoogleEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAccountId, googleCalendarId, rangeStart, rangeEnd]);

  const eventsForDay = (day: Date) => events.filter((e) => isSameDay(parseISO(e.start), day));
  const googleEventsForDay = (day: Date) =>
    googleEvents.filter((e) => !e.allDay && isSameDay(parseISO(e.start), day));

  const coverageCounts = useMemo(() => {
    const counts: Partial<Record<CoverageState, number>> = {};
    for (const e of events) {
      if (!e.coverage) continue;
      counts[e.coverage] = (counts[e.coverage] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60 - HOUR_START) * PX_PER_HOUR;
  const showNowLine = nowTop >= 0 && nowTop <= GRID_HEIGHT;

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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart((w) => subWeeks(w, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
            aria-label="Semaine précédente"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1, locale: fr }))}
            className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
          >
            Aujourd&rsquo;hui
          </button>
          <button
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-btn border border-line text-ink-3 hover:bg-hover"
            aria-label="Semaine suivante"
          >
            <ChevronRight size={14} />
          </button>
          <div className="ml-2 text-sm font-semibold text-ink-2">
            {format(weekDays[0], "d MMMM", { locale: fr })} – {format(weekDays[6], "d MMMM yyyy", { locale: fr })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setLegendOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
            >
              Couverture média
              <ChevronDown size={12} />
            </button>
            {legendOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-[268px] rounded-btn border border-line bg-card p-2 shadow-card">
                {(Object.keys(COVERAGE_LABELS) as CoverageState[]).map((s) => {
                  const Icon = COVERAGE_ICONS[s];
                  return (
                    <div key={s} className="flex items-center gap-2 rounded-btn px-2 py-1.5">
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-btn"
                        style={{ background: COVERAGE_COLORS[s].bg, color: COVERAGE_COLORS[s].ink }}
                      >
                        <Icon size={12} />
                      </span>
                      <span className="flex-1 text-xs text-ink-2">{COVERAGE_LABELS[s].long}</span>
                      <span className="font-mono text-xs text-ink-4">{coverageCounts[s] ?? 0}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {accounts && accounts.length > 0 && (
            <select
              value={googleAccountId ?? ""}
              onChange={(e) => setGoogleAccountId(e.target.value)}
              className="rounded-btn border border-line bg-card px-2 py-1.5 text-xs font-semibold text-ink-2"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.email}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => {
              setNewSlot(null);
              setEditingInternal("new");
            }}
            className="flex items-center gap-1.5 rounded-btn bg-navy px-3.5 py-2 text-sm font-bold text-white hover:bg-navy-600"
          >
            <Plus size={15} /> Nouvel événement
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden rounded-panel border border-line bg-card">
        <div className="w-12 shrink-0 border-r border-line pt-8">
          {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
            <div key={i} style={{ height: PX_PER_HOUR }} className="pr-2 text-right font-mono text-[10px] text-ink-4">
              {HOUR_START + i}h
            </div>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-7 overflow-y-auto">
          {weekDays.map((day) => {
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className="flex flex-col border-r border-line last:border-r-0">
                <div className={`sticky top-0 z-[1] border-b border-line px-2 py-1.5 text-center ${isToday ? "bg-navy text-white" : "bg-card"}`}>
                  <div className="text-[10px] font-mono uppercase tracking-[0.1em] opacity-80">
                    {format(day, "EEE", { locale: fr })}
                  </div>
                  <div className="text-sm font-bold">{format(day, "d")}</div>
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
                    const CoverageIcon = ev.coverage ? COVERAGE_ICONS[ev.coverage] : null;
                    return (
                      <button
                        key={ev.id}
                        onClick={() => setEditingInternal(ev)}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded-chip border-l-4 px-1.5 py-1 text-left shadow-sm"
                        style={{ top, height, background: color.bg, borderLeftColor: color.base }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="truncate text-[11.5px] font-bold" style={{ color: color.ink }}>
                            {ev.title}
                          </span>
                          {CoverageIcon && <CoverageIcon size={10} style={{ color: color.ink }} />}
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
