"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, MapPin, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ComingSoon } from "@/components/fief/ui";
import { MemberGate } from "@/components/fief/shell";

// Calendrier FIEF : les événements du board que l'équipe FIEF a rendus visibles pour la membre
// (fief_my_events, sql/2026-11-13_fief_evenements.sql). Grille du mois + événements à venir.

interface FiefEvent {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  online_meeting: boolean;
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

async function fetchEvents(from: Date, to: Date) {
  const { data } = await createClient().rpc("fief_my_events", { p_from: from.toISOString(), p_to: to.toISOString() });
  return (data ?? []) as FiefEvent[];
}

/** Fichier .ics pour ajouter l'événement à l'agenda du téléphone. */
function downloadIcs(e: FiefEvent) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const end = e.end_date ?? new Date(new Date(e.start_date).getTime() + 3600_000).toISOString();
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LGEF//FIEF//FR",
    "BEGIN:VEVENT",
    `UID:${e.id}@fief.lgef.fr`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start_date)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 60) || "evenement"}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function Calendar() {
  const params = useSearchParams();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthEvents, setMonthEvents] = useState<{ key: string; list: FiefEvent[] } | null>(null);
  const [upcoming, setUpcoming] = useState<FiefEvent[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<FiefEvent | null>(null);
  const monthKey = `${month.getFullYear()}-${month.getMonth()}`;

  useEffect(() => {
    let alive = true;
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    fetchEvents(from, to).then((list) => alive && setMonthEvents({ key: `${month.getFullYear()}-${month.getMonth()}`, list }));
    return () => {
      alive = false;
    };
  }, [month]);

  // Événements à venir (90 jours) ; lien d'une notification (?event=…) : fiche ouverte d'emblée.
  const eventParam = params.get("event");
  useEffect(() => {
    let alive = true;
    const now = new Date();
    fetchEvents(new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 365 * 86_400_000)).then((list) => {
      if (!alive) return;
      setUpcoming(list.slice(0, 30));
      const target = eventParam ? list.find((e) => e.id === eventParam) : null;
      if (target) setOpenEvent(target);
    });
    return () => {
      alive = false;
    };
  }, [eventParam]);

  const events = useMemo(() => (monthEvents?.key === monthKey ? monthEvents.list : []), [monthEvents, monthKey]);
  const byDay = useMemo(() => {
    const map = new Map<string, FiefEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.start_date));
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))] as (Date | null)[];
  }, [month]);

  const todayKey = dayKey(new Date());
  const list = selectedDay ? (byDay.get(selectedDay) ?? []) : upcoming;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Calendrier</h1>
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="rounded-3xl bg-f-surface p-4 border border-f-border">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => { setSelectedDay(null); setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }} aria-label="Mois précédent" className="rounded-full p-2 hover:bg-f-subtle">
              <ChevronLeft size={18} />
            </button>
            <p className="font-extrabold capitalize">{month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</p>
            <button onClick={() => { setSelectedDay(null); setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); }} aria-label="Mois suivant" className="rounded-full p-2 hover:bg-f-subtle">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-f-faint">
            {DAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const k = dayKey(d);
              const has = byDay.has(k);
              const selected = selectedDay === k;
              return (
                <button
                  key={k}
                  onClick={() => setSelectedDay(selected ? null : has ? k : null)}
                  className={`relative flex h-10 items-center justify-center rounded-full text-sm font-semibold ${
                    selected ? "bg-f-accent text-white" : k === todayKey ? "ring-2 ring-f-accent" : has ? "hover:bg-f-subtle" : "text-f-muted"
                  }`}
                >
                  {d.getDate()}
                  {has && <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${selected ? "bg-f-surface" : "bg-[#D7262E]"}`} />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-extrabold">
            {selectedDay ? new Date(byDay.get(selectedDay)![0].start_date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Événements à venir"}
          </h2>
          {list === null && <p className="text-sm text-f-muted">Chargement…</p>}
          {list?.length === 0 && (
            <ComingSoon icon={CalendarDays} title="Aucun événement pour l'instant" text="Les réunions, formations et rencontres FIEF qui vous concernent apparaîtront ici, et vous serez prévenue." />
          )}
          {list?.map((e) => {
            const d = new Date(e.start_date);
            return (
              <button key={e.id} onClick={() => setOpenEvent(e)} className="flex w-full items-center gap-3 rounded-2xl bg-f-surface p-3 text-left border border-f-border hover:ring-2 hover:ring-f-accent/15">
                <span className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-f-danger-bg py-1.5 text-[#D7262E]">
                  <span className="text-[10px] font-bold uppercase">{d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</span>
                  <span className="text-xl font-black leading-none text-f-text">{d.getDate()}</span>
                  <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{e.title}</span>
                  <span className="block truncate text-sm text-f-muted">
                    {time(e.start_date)}
                    {e.online_meeting ? " · En ligne" : e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-f-faint" />
              </button>
            );
          })}
        </div>
      </div>

      {openEvent && <EventSheet event={openEvent} onClose={() => setOpenEvent(null)} />}
    </div>
  );
}

function EventSheet({ event: e, onClose }: { event: FiefEvent; onClose: () => void }) {
  const day = new Date(e.start_date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-f-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-3xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-extrabold">{e.title}</h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1.5 text-f-muted hover:bg-f-subtle">
            <X size={20} />
          </button>
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold capitalize text-f-link">
          <CalendarDays size={16} /> {day} · {time(e.start_date)}
          {e.end_date ? ` – ${time(e.end_date)}` : ""}
        </p>
        {e.online_meeting ? (
          <p className="mt-1 flex items-center gap-2 text-sm text-f-muted">
            <Video size={16} /> En ligne
          </p>
        ) : (
          e.location && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`} target="_blank" rel="noopener" className="mt-1 flex items-center gap-2 text-sm text-f-muted underline-offset-2 hover:underline">
              <MapPin size={16} /> {e.location}
            </a>
          )
        )}
        {e.description && <p className="mt-4 whitespace-pre-line text-[15px] text-f-text">{e.description}</p>}
        <button onClick={() => downloadIcs(e)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-f-accent px-4 py-3 text-[15px] font-bold text-white">
          <CalendarPlus size={18} /> Ajouter à mon agenda
        </button>
      </div>
    </div>
  );
}

export default function FiefCalendarPage() {
  return (
    <MemberGate>
      {() => (
        <Suspense fallback={null}>
          <Calendar />
        </Suspense>
      )}
    </MemberGate>
  );
}
