"use client";

import { useState } from "react";
import { format, addDays, addHours, parseISO } from "date-fns";
import { X, Trash2, MapPin, Users } from "lucide-react";
import { createMyEvent, updateMyEvent, deleteMyEvent, listMyEvents } from "@/app/actions/calendar";
import type { EventInput } from "@/lib/google/calendar";

type EventItem = Awaited<ReturnType<typeof listMyEvents>>[number];

const DAY_FORMAT = "yyyy-MM-dd'T'HH:mm";

function toLocalInputValue(iso: string, allDay: boolean) {
  const date = parseISO(iso);
  return format(date, allDay ? "yyyy-MM-dd" : DAY_FORMAT);
}

/** Édition d'un événement Google Agenda externe (surcouche du calendrier interne). */
export function GoogleEventModal({
  accountId,
  calendarId,
  event,
  onClose,
}: {
  accountId: string;
  calendarId: string;
  event: EventItem | null;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState(event?.summary ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(event ? toLocalInputValue(event.start, event.allDay) : format(new Date(), DAY_FORMAT));
  const [end, setEnd] = useState(event ? toLocalInputValue(event.end, event.allDay) : format(addHours(new Date(), 1), DAY_FORMAT));
  const [attendees, setAttendees] = useState<string[]>(event?.attendees.map((a) => a.email) ?? []);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [saving, setSaving] = useState(false);

  const addAttendee = () => {
    const email = attendeeInput.trim();
    if (email && !attendees.includes(email)) setAttendees((prev) => [...prev, email]);
    setAttendeeInput("");
  };

  const buildInput = (): EventInput => {
    const endValue = allDay ? format(addDays(parseISO(end), 1), "yyyy-MM-dd") : end;
    return { calendarId, summary, description, location, allDay, start, end: endValue, attendees };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const input = buildInput();
      if (event) await updateMyEvent(accountId, event.id, input);
      else await createMyEvent(accountId, input);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    setSaving(true);
    try {
      await deleteMyEvent(accountId, calendarId, event.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-modal border border-line bg-card p-6 shadow-modal">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">
            {event ? "Modifier l'événement Google" : "Nouvel événement Google"}
          </h3>
          <button onClick={onClose} className="text-ink-4 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            placeholder="Titre"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />

          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            Journée entière
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Début</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Fin</label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2">
            <MapPin size={14} className="text-ink-4" />
            <input
              placeholder="Lieu"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full text-sm outline-none"
            />
          </div>

          <textarea
            placeholder="Description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
          />

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
              <Users size={12} /> Invités
            </label>
            <div className="flex flex-wrap gap-1.5 rounded-btn border border-line px-2 py-2">
              {attendees.map((email) => (
                <span key={email} className="flex items-center gap-1 rounded-full bg-subtle px-2 py-1 text-xs text-ink-2">
                  {email}
                  <button onClick={() => setAttendees((prev) => prev.filter((e) => e !== email))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={attendeeInput}
                onChange={(e) => setAttendeeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addAttendee();
                  }
                }}
                onBlur={addAttendee}
                placeholder="email@exemple.com puis Entrée"
                className="min-w-[160px] flex-1 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div>
            {event && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold text-red hover:underline disabled:opacity-60"
              >
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !summary}
            className="flex items-center gap-1.5 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : event ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}
