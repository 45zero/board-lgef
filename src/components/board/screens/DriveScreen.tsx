"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Video,
  Image as ImageIcon,
  Paperclip,
  Download,
  ExternalLink,
  ArrowLeft,
  CalendarDays,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { mapEventRow, type CalendarEvent, type EventRow } from "@/lib/board/calendar";
import { listEventFiles, getEventFileViewUrl, type EventFile } from "@/lib/board/eventFiles";
import { EventModal } from "@/components/board/calendar/EventModal";

interface ArchiveEvent {
  id: string;
  title: string;
  startDate: string;
  fileCount: number;
}

interface MonthGroup {
  key: string;
  year: string;
  monthLabel: string;
  events: ArchiveEvent[];
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function listArchiveEvents(): Promise<ArchiveEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_files")
    .select("event_id, events(id, title, start_date)")
    .eq("storage_provider", "drive");
  if (error || !data) return [];
  const map = new Map<string, ArchiveEvent>();
  for (const row of data as unknown as {
    event_id: string;
    events: { id: string; title: string; start_date: string } | null;
  }[]) {
    const ev = row.events;
    if (!ev) continue;
    const existing = map.get(ev.id);
    if (existing) existing.fileCount += 1;
    else map.set(ev.id, { id: ev.id, title: ev.title, startDate: ev.start_date, fileCount: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.startDate.localeCompare(a.startDate));
}

async function fetchEventForModal(eventId: string): Promise<CalendarEvent | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id, title, event_type, start_date, end_date, location, online_meeting, organizer_message, requires_coverage, created_by, created_at, status"
    )
    .eq("id", eventId)
    .single();
  if (!data) return null;
  return mapEventRow(data as EventRow);
}

function groupByYearMonth(events: ArchiveEvent[]): Record<string, MonthGroup[]> {
  const groups = new Map<string, MonthGroup>();
  for (const ev of events) {
    const d = new Date(ev.startDate);
    const year = format(d, "yyyy");
    const monthNum = format(d, "MM");
    const key = `${year}-${monthNum}`;
    if (!groups.has(key)) {
      groups.set(key, { key, year, monthLabel: `${monthNum} - ${capitalize(format(d, "MMMM", { locale: fr }))}`, events: [] });
    }
    groups.get(key)!.events.push(ev);
  }
  const byYear: Record<string, MonthGroup[]> = {};
  for (const g of Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key))) {
    (byYear[g.year] ??= []).push(g);
  }
  return byYear;
}

function FileRow({ file }: { file: EventFile }) {
  const isVideo = (file.content_type ?? "").startsWith("video");
  const isImage = (file.content_type ?? "").startsWith("image");

  const open = async (download: boolean) => {
    const url = await getEventFileViewUrl(file, download && file.storage_provider === "supabase" ? file.filename : undefined);
    if (url) window.open(url, "_blank", "noreferrer");
  };

  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover">
      {isVideo ? (
        <Video size={16} className="shrink-0 text-ink-4" />
      ) : isImage ? (
        <ImageIcon size={16} className="shrink-0 text-ink-4" />
      ) : (
        <Paperclip size={16} className="shrink-0 text-ink-4" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{file.filename}</span>
      <button onClick={() => open(false)} className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink">
        <ExternalLink size={12} /> Voir
      </button>
      <button onClick={() => open(true)} className="flex items-center gap-1 text-[11px] font-semibold text-ink-3 hover:text-ink">
        <Download size={12} /> Télécharger
      </button>
    </div>
  );
}

/** Archive lisible des médias d'événements (base de données = source de vérité, Drive = stockage). Même forme que GED. */
export function DriveScreen() {
  const [events, setEvents] = useState<ArchiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openYears, setOpenYears] = useState<Set<string>>(new Set());
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ArchiveEvent | null>(null);
  const [files, setFiles] = useState<EventFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [modalEvent, setModalEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    listArchiveEvents().then((evs) => {
      setEvents(evs);
      setLoading(false);
      const groups = groupByYearMonth(evs);
      const firstYear = Object.keys(groups).sort().reverse()[0];
      if (firstYear) {
        setOpenYears(new Set([firstYear]));
        setSelectedMonthKey(groups[firstYear][0]?.key ?? null);
      }
    });
  }, []);

  const groupsByYear = useMemo(() => groupByYearMonth(events), [events]);

  const visibleEvents = useMemo(() => {
    let list = events;
    if (!search.trim()) {
      if (!selectedMonthKey) return [];
      list = list.filter((ev) => {
        const d = new Date(ev.startDate);
        return `${format(d, "yyyy")}-${format(d, "MM")}` === selectedMonthKey;
      });
    } else {
      list = list.filter((ev) => ev.title.toLowerCase().includes(search.toLowerCase()));
    }
    return list;
  }, [events, selectedMonthKey, search]);

  const openEvent = async (ev: ArchiveEvent) => {
    setSelectedEvent(ev);
    setFilesLoading(true);
    setFiles(await listEventFiles(ev.id));
    setFilesLoading(false);
  };

  const openEventModal = async (ev: ArchiveEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    const full = await fetchEventForModal(ev.id);
    if (full) setModalEvent(full);
  };

  return (
    <div className="flex h-full gap-3 p-4">
      <aside className="flex w-[200px] shrink-0 flex-col gap-1 overflow-y-auto rounded-panel border border-line bg-card p-2">
        <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Archives</div>
        {Object.keys(groupsByYear)
          .sort()
          .reverse()
          .map((year) => {
            const isOpen = openYears.has(year);
            return (
              <div key={year}>
                <button
                  onClick={() =>
                    setOpenYears((prev) => {
                      const next = new Set(prev);
                      if (next.has(year)) next.delete(year);
                      else next.add(year);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-1.5 rounded-btn px-2 py-2 text-left text-sm font-bold text-ink hover:bg-hover"
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {year}
                </button>
                {isOpen && (
                  <div className="ml-2 space-y-0.5 border-l border-line pl-2">
                    {groupsByYear[year].map((g) => (
                      <button
                        key={g.key}
                        onClick={() => {
                          setSearch("");
                          setSelectedMonthKey(g.key);
                          setSelectedEvent(null);
                        }}
                        className={`flex w-full items-center justify-between rounded-btn px-2 py-1.5 text-left text-xs font-semibold ${
                          selectedMonthKey === g.key && !search ? "bg-navy text-white" : "text-ink-2 hover:bg-hover"
                        }`}
                      >
                        {g.monthLabel}
                        <span className={selectedMonthKey === g.key && !search ? "text-white/70" : "text-ink-4"}>
                          {g.events.length}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        {!loading && Object.keys(groupsByYear).length === 0 && (
          <p className="px-2 py-2 text-xs italic text-ink-4">Aucune archive pour l&rsquo;instant.</p>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-2">
          <Search size={14} className="shrink-0 text-ink-4" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedEvent(null);
            }}
            placeholder="Rechercher un événement…"
            className="w-full text-sm outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-panel border border-line bg-card">
          {selectedEvent ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="flex items-center gap-1 text-xs font-semibold text-ink-3 hover:text-ink"
                >
                  <ArrowLeft size={13} /> Retour
                </button>
                <span className="truncate text-sm font-bold text-ink">{selectedEvent.title}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filesLoading ? (
                  <div className="p-4 text-sm text-ink-4">Chargement…</div>
                ) : files.length === 0 ? (
                  <div className="p-4 text-sm text-ink-4">Aucun document.</div>
                ) : (
                  files.map((f) => <FileRow key={f.id} file={f} />)
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-4">Chargement…</div>
          ) : visibleEvents.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-4">
              {search ? "Aucun résultat." : "Aucun événement pour ce mois."}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {visibleEvents.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => openEvent(ev)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                >
                  <CalendarDays size={16} className="shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{ev.title}</span>
                    <span className="block text-xs text-ink-4">
                      {format(new Date(ev.startDate), "d MMMM yyyy", { locale: fr })} · {ev.fileCount} document
                      {ev.fileCount > 1 ? "s" : ""}
                    </span>
                  </span>
                  <span
                    onClick={(e) => openEventModal(ev, e)}
                    role="button"
                    tabIndex={0}
                    className="shrink-0 rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover"
                  >
                    Ouvrir l&rsquo;événement
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalEvent && (
        <EventModal event={modalEvent} onClose={() => setModalEvent(null)} onSaved={() => setModalEvent(null)} />
      )}
    </div>
  );
}
