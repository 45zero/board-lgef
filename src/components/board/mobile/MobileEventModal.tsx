"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { X, Trash2, MapPin, ChevronDown } from "lucide-react";
import { ORG_LABELS, ORG_COLORS } from "@/lib/board/tokens";
import { CALENDAR_ORG_KEYS, type CalendarEvent } from "@/lib/board/calendar";
import { useEventModalState } from "@/hooks/board/useEventModalState";
import {
  personName,
  DiscussionTab,
  EquipeTab,
  FraisTab,
  GestionFraisPlaceholder,
  CarteTab,
  CoverageActions,
  DirectorAttendanceSection,
} from "@/components/board/calendar/EventTabs";

type Tab = "details" | "discussion" | "equipe" | "frais" | "gestion" | "carte";

const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Détails" },
  { id: "discussion", label: "Discussion" },
  { id: "equipe", label: "Équipe" },
  { id: "frais", label: "Mes frais" },
  { id: "gestion", label: "Gestion frais" },
  { id: "carte", label: "Carte" },
];

export function MobileEventModal({
  event,
  defaultStart,
  defaultEnd,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  defaultStart?: Date;
  defaultEnd?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const m = useEventModalState({ event, defaultStart, defaultEnd, onClose, onSaved });
  const { isEditing } = m;
  const orgColor = ORG_COLORS[m.org];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      <div className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-ink-4/30" />

      <div className="shrink-0 px-4 pb-3 pt-2">
        <div className="flex items-start justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: orgColor.bg, color: orgColor.ink }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: orgColor.base }} />
            {ORG_LABELS[m.org]}
          </span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4">
            <X size={18} />
          </button>
        </div>
        <input
          value={m.title}
          onChange={(e) => m.setTitle(e.target.value)}
          placeholder="Titre de l'événement"
          className="mt-2 w-full border-b-2 border-line bg-transparent pb-1.5 text-lg font-extrabold text-ink outline-none focus:border-navy"
        />
        <div className="mt-1 text-xs text-ink-3">
          {format(m.start, "EEEE d MMMM", { locale: fr })} — de {m.startTime} à {m.endTime}
        </div>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 pb-2">
        {TABS.map((t) => {
          const count =
            t.id === "equipe"
              ? m.team.team.length
              : t.id === "discussion"
                ? m.comments.comments.length
                : t.id === "frais"
                  ? m.expenses.expenses.length
                  : null;
          const disabled = !isEditing && t.id !== "details";
          return (
            <button
              key={t.id}
              disabled={disabled}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                tab === t.id ? "bg-navy text-white" : "bg-subtle text-ink-3"
              }`}
            >
              {t.label}
              {count !== null && count > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "details" && (
          <div className="space-y-4">
            <div className="relative">
              <button
                onClick={() => setOrgPickerOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-btn border border-line px-3 py-2.5 text-sm font-semibold text-ink-2"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: orgColor.base }} />
                  {ORG_LABELS[m.org]}
                </span>
                <ChevronDown size={14} />
              </button>
              {orgPickerOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-btn border border-line bg-card p-1 shadow-card">
                  {CALENDAR_ORG_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        m.setOrg(key);
                        setOrgPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-left text-sm hover:bg-hover"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: ORG_COLORS[key].base }} />
                      {ORG_LABELS[key]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <input
                type="date"
                value={m.dateStr}
                onChange={(e) => m.setDateStr(e.target.value)}
                className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={m.startTime}
                  onChange={(e) => m.setStartTime(e.target.value)}
                  className="w-full rounded-btn border border-line px-3 py-2.5 text-sm font-mono outline-none"
                />
                <input
                  type="time"
                  value={m.endTime}
                  onChange={(e) => m.setEndTime(e.target.value)}
                  className="w-full rounded-btn border border-line px-3 py-2.5 text-sm font-mono outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2.5">
              <MapPin size={14} className="text-ink-4" />
              <input
                value={m.location}
                onChange={(e) => m.setLocation(e.target.value)}
                placeholder="Lieu"
                className="w-full text-sm outline-none"
              />
            </div>

            <textarea
              value={m.message}
              onChange={(e) => m.setMessage(e.target.value)}
              rows={3}
              placeholder="Message (optionnel)"
              className="w-full rounded-btn border border-line px-3 py-2.5 text-sm outline-none"
            />

            {isEditing && (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    <span>Équipe</span>
                    <button onClick={() => setTab("equipe")} className="text-link">Gérer</button>
                  </div>
                  {m.team.team.length === 0 ? (
                    <p className="text-xs italic text-ink-4">Aucun membre pour l&rsquo;instant.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {m.team.team.map((tm) => (
                        <span key={tm.id} className="rounded-full bg-subtle px-2 py-1 text-xs text-ink-2">
                          {personName(tm.profiles)}
                          {tm.role === "responsable" && " ⭐"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Comité directeur</div>
                  <DirectorAttendanceSection director={m.director} eventId={event!.id} />
                  <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                    <input type="checkbox" checked={m.reminderOn} onChange={m.toggleReminder} />
                    Me rappeler — 30 minutes avant le début
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "discussion" && isEditing && <DiscussionTab hook={m.comments} />}
        {tab === "equipe" && isEditing && <EquipeTab hook={m.team} />}
        {tab === "frais" && isEditing && <FraisTab hook={m.expenses} />}
        {tab === "gestion" && <GestionFraisPlaceholder />}
        {tab === "carte" && <CarteTab location={m.location} />}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        {isEditing && (
          <div className="flex justify-end">
            <CoverageActions
              role={m.role}
              technicians={m.technicians}
              coverage={m.coverage}
              eventInfo={{ title: m.title, start: m.start }}
            />
          </div>
        )}
        <div className="flex items-center justify-between">
          {isEditing ? (
            <button
              onClick={m.handleDelete}
              disabled={m.saving}
              className="flex items-center gap-1.5 text-xs font-semibold text-red disabled:opacity-60"
            >
              <Trash2 size={13} /> Supprimer
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={m.handleSave}
            disabled={m.saving || !m.title.trim()}
            className="rounded-btn bg-red px-5 py-2.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
          >
            {m.saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
