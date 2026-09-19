"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  X,
  Trash2,
  MapPin,
  ChevronDown,
  Send,
  UserPlus,
  Navigation,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ORG_LABELS, ORG_COLORS, type OrgKey } from "@/lib/board/tokens";
import { CALENDAR_ORG_KEYS, ORG_TO_EVENT_TYPE, type CalendarEvent } from "@/lib/board/calendar";
import { useEventTeam, type TeamMember } from "@/hooks/board/useEventTeam";
import { useDirectorAttendance } from "@/hooks/board/useDirectorAttendance";
import { useEventComments } from "@/hooks/board/useEventComments";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import { useEventActions, type EventFormPayload } from "@/hooks/board/useEventActions";

type Tab = "details" | "discussion" | "equipe" | "frais" | "gestion" | "carte";

const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Détails" },
  { id: "discussion", label: "Discussion" },
  { id: "equipe", label: "Équipe" },
  { id: "frais", label: "Mes frais" },
  { id: "gestion", label: "Gestion frais" },
  { id: "carte", label: "Carte" },
];

function personName(p: { first_name: string | null; last_name: string | null; email: string | null } | null) {
  if (!p) return "—";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || "—";
}

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
  const { user } = useAuth();
  const isEditing = !!event;
  const [tab, setTab] = useState<Tab>("details");

  const [org, setOrg] = useState<Exclude<OrgKey, "perso">>(
    (event?.org as Exclude<OrgKey, "perso">) ?? "navy"
  );
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [message, setMessage] = useState(event?.message ?? "");
  const start = event ? parseISO(event.start) : defaultStart ?? new Date();
  const end = event ? parseISO(event.end) : defaultEnd ?? new Date(Date.now() + 3600_000);
  const [dateStr, setDateStr] = useState(format(start, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(end, "HH:mm"));
  const [saving, setSaving] = useState(false);
  const [reminderOn, setReminderOn] = useState(false);

  const { createEvent, updateEvent, deleteEventCascade } = useEventActions();
  const team = useEventTeam(event?.id ?? "", event?.createdBy ?? null);
  const director = useDirectorAttendance(event?.id);
  const comments = useEventComments(event?.id ?? "");
  const expenses = useEventExpenses(event?.id ?? "");

  useEffect(() => {
    if (!event) return;
    const supabase = createClient();
    supabase
      .from("event_reminders")
      .select("id")
      .eq("event_id", event.id)
      .eq("user_id", user?.id ?? "")
      .maybeSingle()
      .then(({ data }) => setReminderOn(!!data));
  }, [event, user?.id]);

  const toggleReminder = async () => {
    if (!event || !user) return;
    const supabase = createClient();
    if (reminderOn) {
      await supabase.from("event_reminders").delete().eq("event_id", event.id).eq("user_id", user.id);
      setReminderOn(false);
    } else {
      const remindAt = new Date(parseISO(event.start).getTime() - 30 * 60_000);
      await supabase.from("event_reminders").insert({
        event_id: event.id,
        user_id: user.id,
        remind_at: remindAt.toISOString(),
        reminder_offset: "30min",
        channels: ["app"],
      });
      setReminderOn(true);
    }
  };

  const buildPayload = (): EventFormPayload => {
    const startISO = new Date(`${dateStr}T${startTime}:00`).toISOString();
    const endISO = new Date(`${dateStr}T${endTime}:00`).toISOString();
    return { title, eventType: ORG_TO_EVENT_TYPE[org], location, message, startISO, endISO };
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      const ok = isEditing && event ? await updateEvent(event.id, payload) : await createEvent(payload);
      if (ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    setSaving(true);
    try {
      const ok = await deleteEventCascade(event.id);
      if (ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const orgColor = ORG_COLORS[org];
  const subtitleRange = `${format(start, "EEEE d MMMM", { locale: fr })} — de ${startTime} à ${endTime}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[880px] w-full max-w-[900px] flex-col overflow-hidden rounded-modal bg-card shadow-modal">
        {/* Bandeau */}
        <div className="flex items-start justify-between gap-4 bg-navy px-6 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
              Calendrier · Board LGEF
            </div>
            <h2 className="mt-1 text-xl font-extrabold">{title || "Nouvel événement"}</h2>
            <div className="mt-1 text-sm text-white/80">{subtitleRange}</div>
            {isEditing && event.createdAt && (
              <div className="mt-1 text-xs text-white/60">
                Créé le {format(parseISO(event.createdAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
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
              t.id === "equipe" ? team.team.length : t.id === "discussion" ? comments.comments.length : t.id === "frais" ? expenses.expenses.length : null;
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
                  {ORG_LABELS[org]}
                  <ChevronDown size={12} />
                </button>
                {orgPickerOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
                    {CALENDAR_ORG_KEYS.map((key) => (
                      <button
                        key={key}
                        onClick={() => {
                          setOrg(key);
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
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titre de l'événement"
                className="w-full border-b-2 border-line bg-transparent pb-2 text-[22px] font-extrabold text-ink outline-none focus:border-navy"
              />

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Date</label>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Début</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Fin</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-3 py-2 text-sm font-mono outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2">
                <MapPin size={14} className="text-ink-4" />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Lieu"
                  className="w-full text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                  Message (optionnel)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
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
                  ) : team.team.length === 0 ? (
                    <p className="text-xs italic text-ink-4">Aucun membre pour l&rsquo;instant.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {team.team.map((m) => (
                        <span key={m.id} className="rounded-full bg-subtle px-2 py-1 text-xs text-ink-2">
                          {personName(m.profiles)}
                          {m.role === "responsable" && " ⭐"}
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
                      <select
                        value={director.attendance?.director_id ?? ""}
                        onChange={async (e) => {
                          const id = e.target.value || null;
                          if (!id) await director.deleteAttendance();
                          else await director.saveAttendance(event!.id, { director_id: id, status: "approved" });
                        }}
                        className="w-full rounded-btn border border-line px-2 py-1.5 text-xs"
                      >
                        <option value="">Aucun membre désigné</option>
                        {director.directors.map((d) => (
                          <option key={d.id} value={d.id}>
                            {personName(d)}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-xs text-ink-2">
                        <input type="checkbox" checked={reminderOn} onChange={toggleReminder} />
                        Me rappeler — 30 minutes avant le début
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "discussion" && isEditing && <DiscussionTab hook={comments} />}
          {tab === "equipe" && isEditing && <EquipeTab hook={team} />}
          {tab === "frais" && isEditing && <FraisTab hook={expenses} />}
          {tab === "gestion" && (
            <div className="rounded-panel border border-dashed border-line bg-card/60 p-6 text-sm text-ink-3">
              La validation des notes de frais par un administrateur n&rsquo;est pas encore construite dans
              Board LGEF — elle nécessite de porter <code>useAdminExpenseReports</code> et{" "}
              <code>useExpenseSubmissions</code> de calendrier-lgef. À venir dans une prochaine passe.
            </div>
          )}
          {tab === "carte" && <CarteTab location={location} />}
        </div>

        {/* Pied */}
        <div className="flex items-center justify-between border-t border-line px-6 py-3">
          <div>
            {isEditing && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold text-red hover:underline disabled:opacity-60"
              >
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="rounded-btn bg-red px-4 py-2 text-sm font-bold text-white shadow-btn-red disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscussionTab({ hook }: { hook: ReturnType<typeof useEventComments> }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {hook.comments.length === 0 && <p className="text-sm text-ink-4">Aucun message pour l&rsquo;instant.</p>}
        {hook.comments.map((c) => (
          <div key={c.id} className="rounded-btn bg-subtle px-3 py-2">
            <div className="text-xs font-semibold text-ink-2">{personName(c.author)}</div>
            <div className="text-sm text-ink">{c.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          placeholder="Écrire un message…"
          className="flex-1 rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={async () => {
            if (value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          className="flex h-9 w-9 items-center justify-center rounded-btn bg-navy text-white"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

interface ProfileOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

function EquipeTab({ hook }: { hook: ReturnType<typeof useEventTeam> }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [pickerOpen]);

  const filtered = options.filter((o) =>
    personName(o).toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {hook.team.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
          <div className="text-sm text-ink-2">
            {personName(m.profiles)}
            {m.role === "responsable" && <span className="ml-1 text-xs text-ink-4">(responsable)</span>}
          </div>
          {hook.canManageMembers && (
            <button onClick={() => hook.removeMember(m)} className="text-xs font-semibold text-red hover:underline">
              Retirer
            </button>
          )}
        </div>
      ))}

      {hook.canManageMembers && (
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <UserPlus size={13} /> Ajouter
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-btn border border-line bg-card p-2 shadow-card">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="mb-2 w-full rounded-btn border border-line px-2 py-1.5 text-sm outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      await hook.addMember(p.id, "membre");
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                  >
                    {personName(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FraisTab({ hook }: { hook: ReturnType<typeof useEventExpenses> }) {
  const [toll, setToll] = useState(0);
  const [meal, setMeal] = useState(0);
  const [other, setOther] = useState(0);
  const [otherDesc, setOtherDesc] = useState("");

  const total = hook.expenses.reduce((sum, e) => sum + (e.total_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="text-lg font-extrabold text-ink">{total.toFixed(2)} €</div>

      {hook.expenses.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2 text-sm">
          <span>
            Péage {e.toll_fees ?? 0} € · Repas {e.meal_fees ?? 0} € · Autres {e.other_fees ?? 0} €
            {e.other_fees_description ? ` (${e.other_fees_description})` : ""}
          </span>
          <button onClick={() => hook.deleteExpense(e.id)} className="text-xs font-semibold text-red hover:underline">
            Supprimer
          </button>
        </div>
      ))}

      <div className="space-y-2 rounded-panel border border-line p-3">
        <div className="grid grid-cols-3 gap-2">
          <input type="number" min={0} step={0.01} value={toll || ""} onChange={(e) => setToll(parseFloat(e.target.value) || 0)} placeholder="Péage €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={meal || ""} onChange={(e) => setMeal(parseFloat(e.target.value) || 0)} placeholder="Repas €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={other || ""} onChange={(e) => setOther(parseFloat(e.target.value) || 0)} placeholder="Autres €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
        </div>
        {other > 0 && (
          <input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} placeholder="Description des autres frais" className="w-full rounded-btn border border-line px-2 py-1.5 text-sm" />
        )}
        <button
          onClick={async () => {
            const ok = await hook.createExpense({ toll_fees: toll, meal_fees: meal, other_fees: other, other_fees_description: otherDesc || null });
            if (ok) {
              setToll(0);
              setMeal(0);
              setOther(0);
              setOtherDesc("");
            }
          }}
          disabled={toll === 0 && meal === 0 && other === 0}
          className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          Ajouter la ligne de frais
        </button>
      </div>
    </div>
  );
}

function CarteTab({ location }: { location: string }) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  return (
    <div className="space-y-3">
      <div className="flex h-[240px] items-center justify-center rounded-panel border border-dashed border-line bg-subtle text-sm text-ink-4">
        Emplacement réservé pour la vue cartographique (à fournir par le client — voir handoff §3)
      </div>
      <div className="text-sm text-ink-2">{location || "Aucune adresse renseignée."}</div>
      {location && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover"
        >
          <Navigation size={13} /> Itinéraire
        </a>
      )}
    </div>
  );
}
