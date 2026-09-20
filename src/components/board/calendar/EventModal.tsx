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

export function EventModal({
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
  const subtitleRange = `${format(m.start, "EEEE d MMMM", { locale: fr })} — de ${m.startTime} à ${m.endTime}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[880px] w-full max-w-[900px] flex-col overflow-hidden rounded-modal bg-card shadow-modal">
        {/* Bandeau */}
        <div className="flex items-start justify-between gap-4 bg-navy px-6 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
              Calendrier · Board LGEF
            </div>
            <h2 className="mt-1 text-xl font-extrabold">{m.title || "Nouvel événement"}</h2>
            <div className="mt-1 text-sm text-white/80">{subtitleRange}</div>
            {isEditing && event!.createdAt && (
              <div className="mt-1 text-xs text-white/60">
                Créé le {format(parseISO(event!.createdAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* Onglets */}
        <div className="flex items-center gap-1 border-b border-line bg-panel px-4 py-2">
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
                title={disabled ? "Disponible après la création de l'événement" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  tab === t.id ? "bg-card text-ink shadow-card ring-1 ring-line" : "text-ink-3 hover:bg-hover"
                }`}
              >
                {t.label}
                {count !== null && count > 0 && (
                  <span className="rounded-full bg-subtle px-1.5 text-[10px] text-ink-3">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "details" && (
            <div className="space-y-4">
              <div className="relative inline-block">
                <button
                  onClick={() => setOrgPickerOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-semibold"
                  style={{ background: orgColor.bg, color: orgColor.ink }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: orgColor.base }} />
                  {ORG_LABELS[m.org]}
                  <ChevronDown size={12} />
                </button>
                {orgPickerOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
                    {CALENDAR_ORG_KEYS.map((key) => (
                      <button
                        key={key}
                        onClick={() => {
                          m.setOrg(key);
                          setOrgPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: ORG_COLORS[key].base }} />
                        {ORG_LABELS[key]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <input
                value={m.title}
                onChange={(e) => m.setTitle(e.target.value)}
                placeholder="Titre de l'événement"
                className="w-full border-b-2 border-line bg-transparent pb-2 text-[22px] font-extrabold text-ink outline-none focus:border-navy"
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Date</label>
                  <input
                    type="date"
                    value={m.dateStr}
                    onChange={(e) => m.setDateStr(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Début</label>
                  <input
                    type="time"
                    value={m.startTime}
                    onChange={(e) => m.setStartTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Fin</label>
                  <input
                    type="time"
                    value={m.endTime}
                    onChange={(e) => m.setEndTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm font-mono outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2">
                <MapPin size={14} className="text-ink-4" />
                <input
                  value={m.location}
                  onChange={(e) => m.setLocation(e.target.value)}
                  placeholder="Lieu"
                  className="w-full text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                  Message (optionnel)
                </label>
                <textarea
                  value={m.message}
                  onChange={(e) => m.setMessage(e.target.value)}
                  rows={3}
                  className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    <span>Équipe</span>
                    {isEditing && (
                      <button onClick={() => setTab("equipe")} className="text-link hover:underline">
                        Gérer
                      </button>
                    )}
                  </div>
                  {!isEditing ? (
                    <p className="text-xs italic text-ink-4">Disponible après la création.</p>
                  ) : m.team.team.length === 0 ? (
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
                  {!isEditing ? (
                    <p className="text-xs italic text-ink-4">Disponible après la création.</p>
                  ) : (
                    <div className="space-y-2">
                      <DirectorAttendanceSection director={m.director} eventId={event!.id} />
                      <label className="flex items-center gap-2 text-xs text-ink-2">
                        <input type="checkbox" checked={m.reminderOn} onChange={m.toggleReminder} />
                        Me rappeler — 30 minutes avant le début
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "discussion" && isEditing && <DiscussionTab hook={m.comments} />}
          {tab === "equipe" && isEditing && <EquipeTab hook={m.team} />}
          {tab === "frais" && isEditing && <FraisTab hook={m.expenses} />}
          {tab === "gestion" && <GestionFraisPlaceholder />}
          {tab === "carte" && <CarteTab location={m.location} />}
        </div>

        {/* Pied */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
          <div>
            {isEditing && (
              <button
                onClick={m.handleDelete}
                disabled={m.saving}
                className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-red hover:underline disabled:opacity-60"
              >
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isEditing && (
              <CoverageActions
                role={m.role}
                technicians={m.technicians}
                coverage={m.coverage}
                eventInfo={{ title: m.title, start: m.start }}
              />
            )}
            <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
              Annuler
            </button>
            <button
              onClick={m.handleSave}
              disabled={m.saving || !m.title.trim()}
              className="rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
            >
              {m.saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
