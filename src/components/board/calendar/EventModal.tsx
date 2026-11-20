"use client";

import { EventCrewBar } from "@/components/board/calendar/EventCrewBar";
import { EventWeather } from "@/components/board/calendar/DayWeather";
import { EventTeamCards } from "@/components/board/team/TeamCardOpener";
import {
  EventPlanningTab,
  MyPresenceBar,
  MySingleDaySlot,
  MyPresenceBadge,
} from "@/components/board/calendar/EventPlanningTab";
import { DaySlotsPicker } from "@/components/board/calendar/DaySlotsPicker";
import { PersonPicker } from "@/components/board/calendar/PersonPicker";
import { eventDays } from "@/lib/board/presence";
import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import {
  X,
  Trash2,
  MapPin,
  ChevronDown,
  Camera,
  Video,
  ClipboardCheck,
  FileText,
  MessageSquare,
  Users,
  Receipt,
  Wallet,
  Map as MapIcon,
  Sprout,
  CalendarRange,
} from "lucide-react";
import { ORG_LABELS, ORG_COLORS } from "@/lib/board/tokens";
import { isMultiDayEvent, type CalendarEvent } from "@/lib/board/calendar";
import { useEventModalState } from "@/hooks/board/useEventModalState";
import { PersonName } from "@/components/board/calendar/PersonName";
import { useGoogleMapsScript } from "@/hooks/useGoogleMapsScript";
import { Toggle } from "@/components/board/Toggle";
import { FiefEventShare } from "@/components/board/fief/FiefEventShare";
import {
  canShowModule,
  useVisibleModules,
} from "@/hooks/board/useVisibleModules";
import { DraftNotice } from "@/components/board/calendar/VoiceEvent";
import {
  RoutePreview,
  ScheduleConflictWarning,
} from "@/components/board/calendar/EventSchedule";
import type { EventDraft } from "@/app/actions/event-dictation";
import {
  personName,
  DiscussionTab,
  EquipeTab,
  FraisTab,
  GestionFraisTab,
  CarteTab,
  ParticipantsField,
  RemindersField,
  AttachmentsField,
} from "@/components/board/calendar/EventTabs";

// Encarts de la fiche : couverture médiatique en bleu, comité directeur en doré (couleur de sa pastille).
const COVERAGE_ACCENT = ORG_COLORS.pem;
const CD_ACCENT = ORG_COLORS.tirages;
const panelStyle = (c: { base: string; bg: string }) => ({
  borderColor: `color-mix(in srgb, ${c.base} 25%, transparent)`,
  borderLeftColor: c.base,
  background: `color-mix(in srgb, ${c.bg} 55%, var(--color-card))`,
});

type Tab =
  | "details"
  | "planning"
  | "discussion"
  | "equipe"
  | "frais"
  | "gestion"
  | "carte"
  | "fief";

// Onglets en icônes (le nom en info-bulle et pour les lecteurs d'écran).
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "details", label: "Détails", icon: FileText },
  {
    id: "planning",
    label: "Planning — présence jour par jour",
    icon: CalendarRange,
  },
  { id: "discussion", label: "Discussion", icon: MessageSquare },
  { id: "equipe", label: "Équipe", icon: Users },
  { id: "frais", label: "Mes frais", icon: Receipt },
  { id: "gestion", label: "Gestion frais", icon: Wallet },
  { id: "carte", label: "Carte", icon: MapIcon },
  { id: "fief", label: "FIEF — Visible sur FIEF", icon: Sprout },
];

export function EventModal({
  event,
  defaultStart,
  defaultEnd,
  draft,
  onClose,
  onSaved,
  initialTab,
}: {
  event: CalendarEvent | null;
  defaultStart?: Date;
  defaultEnd?: Date;
  draft?: EventDraft | null;
  onClose: () => void;
  onSaved: () => void;
  /** Onglet ouvert d'emblée (ex. « discussion » depuis une notification de mention). */
  initialTab?: "discussion";
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "details");
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const mapsLoaded = useGoogleMapsScript();

  const m = useEventModalState({
    event,
    defaultStart,
    defaultEnd,
    draft,
    onClose,
    onSaved,
  });
  // Champ « Au » : affiché d'emblée pour un événement sur plusieurs jours, sinon via « + jours ».
  const [multiDayOpen, setMultiDay] = useState(false);
  const multiDay = multiDayOpen || m.endDayOffset > 0;
  // Onglet Planning : événement existant sur plusieurs jours. askMine : vient d'accepter / de se proposer.
  const showPlanning = !!event && isMultiDayEvent(event);
  const [askMine, setAskMine] = useState(false);
  const [cdOpen, setCdOpen] = useState(false);
  const openPlanning = (ask = false) => {
    setAskMine(ask);
    setTab("planning");
  };
  const formDays =
    /^\d{4}-\d{2}-\d{2}$/.test(m.dateStr) &&
    /^\d{4}-\d{2}-\d{2}$/.test(m.endDateStr)
      ? eventDays(`${m.dateStr}T12:00:00`, `${m.endDateStr}T13:00:00`)
      : [];
  const { isEditing } = m;
  // Onglet FIEF : équipe FIEF seulement (module « fief »).
  const showFief = canShowModule(useVisibleModules(), "fief");

  useEffect(() => {
    if (!mapsLoaded || !locationInputRef.current) return;
    const autocomplete = new google.maps.places.Autocomplete(
      locationInputRef.current,
      {
        fields: ["formatted_address"],
        componentRestrictions: { country: "fr" },
      }
    );
    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) m.setLocation(place.formatted_address);
    });
    return () => listener.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- m.setLocation est stable (setter React), pas besoin de le lister
  }, [mapsLoaded]);
  const orgColor = ORG_COLORS[m.org];
  const subtitleRange = `${format(m.start, "EEEE d MMMM", {
    locale: fr,
  })} — de ${m.startTime} à ${m.endTime}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex h-[min(860px,calc(100vh-2rem))] w-full max-w-[900px] flex-col overflow-hidden rounded-modal bg-card shadow-modal">
        {/* Bandeau */}
        <div className="flex shrink-0 items-start justify-between gap-4 bg-navy px-6 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
              Calendrier · Board LGEF
            </div>
            <h2 className="mt-1 text-xl font-extrabold">
              {m.title || "Nouvel événement"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/80">
              {subtitleRange}
              <EventWeather eventId={event?.id} />
              {event && <MyPresenceBadge eventId={event.id} multiDay={showPlanning} />}
            </div>
            {isEditing && event!.createdAt && (
              <div className="mt-1 text-xs text-white/60">
                Créé le{" "}
                {format(parseISO(event!.createdAt), "d MMMM yyyy 'à' HH:mm", {
                  locale: fr,
                })}
                <PersonName userId={event!.createdBy} />
              </div>
            )}
            {isEditing &&
              event!.updatedAt &&
              // Une ligne « modifié » seulement si l'événement a vraiment été retouché après sa création.
              (!event!.createdAt ||
                Date.parse(event!.updatedAt) - Date.parse(event!.createdAt) >
                  60_000) && (
                <div className="text-xs text-white/60">
                  Modifié le{" "}
                  {format(parseISO(event!.updatedAt), "d MMMM yyyy 'à' HH:mm", {
                    locale: fr,
                  })}
                  <PersonName userId={event!.updatedBy} />
                </div>
              )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Onglets */}
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-4 py-2">
          {TABS.filter(
            (t) =>
              (t.id !== "fief" || showFief) &&
              (t.id !== "planning" || showPlanning)
          ).map((t) => {
            const count =
              t.id === "equipe"
                ? m.team.team.length
                : t.id === "discussion"
                ? m.comments.comments.length
                : t.id === "frais"
                ? m.expenses.expenses.length
                : null;
            const disabled = !isEditing && t.id !== "details";
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                disabled={disabled}
                onClick={() => setTab(t.id)}
                title={
                  disabled
                    ? `${t.label} — disponible après la création de l'événement`
                    : t.label
                }
                aria-label={t.label}
                className={`relative flex h-9 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  tab === t.id
                    ? "bg-card text-navy shadow-card ring-1 ring-line"
                    : "text-ink-3 hover:bg-hover"
                }`}
              >
                <Icon size={17} />
                {count !== null && count > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-navy px-1 text-[9px] font-bold leading-4 text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenu */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "details" && (
            <div className="space-y-4">
              {m.draft && <DraftNotice draft={m.draft} />}
              <div className="relative inline-block">
                <button
                  onClick={() => setOrgPickerOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-semibold"
                  style={{ background: orgColor.bg, color: orgColor.ink }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: orgColor.base }}
                  />
                  {ORG_LABELS[m.org]}
                  <ChevronDown size={12} />
                </button>
                {orgPickerOpen && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-btn border border-line bg-card p-1 shadow-card">
                    {(m.orgOptions ?? [m.org]).map((key) => (
                      <button
                        key={key}
                        onClick={() => {
                          m.setOrg(key);
                          setOrgPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: ORG_COLORS[key].base }}
                        />
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

              <div className="flex flex-wrap items-end gap-2">
                <div className="w-[138px]">
                  <label className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    {multiDay ? "Du" : "Date"}
                    {!multiDay && (
                      <button
                        type="button"
                        onClick={() => setMultiDay(true)}
                        title="Événement sur plusieurs jours"
                        className="font-sans text-[10px] font-semibold normal-case tracking-normal text-link hover:underline"
                      >
                        + jours
                      </button>
                    )}
                  </label>
                  <input
                    type="date"
                    value={m.dateStr}
                    onChange={(e) => m.setDateStr(e.target.value)}
                    className="w-full rounded-btn border border-line px-2 py-1.5 text-xs outline-none"
                  />
                </div>
                {multiDay && (
                  <div className="w-[138px]">
                    <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                      Au
                      {m.endDayOffset > 0
                        ? ` · ${m.endDayOffset + 1} jours`
                        : ""}
                    </label>
                    <input
                      type="date"
                      value={m.endDateStr}
                      min={m.dateStr}
                      onChange={(e) => m.setEndDateStr(e.target.value)}
                      className="w-full rounded-btn border border-line px-2 py-1.5 text-xs outline-none"
                    />
                  </div>
                )}
                <div className="w-[84px]">
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    Début
                  </label>
                  <input
                    type="time"
                    value={m.startTime}
                    onChange={(e) => m.setStartTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-2 py-1.5 text-xs font-mono outline-none"
                  />
                </div>
                <div className="w-[84px]">
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    Fin
                  </label>
                  <input
                    type="time"
                    value={m.endTime}
                    onChange={(e) => m.setEndTime(e.target.value)}
                    className="w-full rounded-btn border border-line px-2 py-1.5 text-xs font-mono outline-none"
                  />
                </div>
                <div className="min-w-[150px] flex-1">
                  <label className="mb-1 block text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    Rappel
                  </label>
                  <RemindersField
                    offsets={
                      isEditing
                        ? m.reminders.map((r) => r.reminder_offset)
                        : m.pendingReminders
                    }
                    onAdd={isEditing ? m.addReminder : m.addPendingReminder}
                    onRemove={
                      isEditing
                        ? (offset) => {
                            const r = m.reminders.find(
                              (r) => r.reminder_offset === offset
                            );
                            if (r) m.removeReminder(r.id);
                          }
                        : m.removePendingReminder
                    }
                  />
                </div>
              </div>

              <ScheduleConflictWarning
                startISO={m.slot?.startISO ?? null}
                endISO={m.slot?.endISO ?? null}
                excludeEventId={event?.id}
                location={m.onlineMeeting ? "" : m.location}
              />

              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                  <span>Participants</span>
                  {isEditing && (
                    <button
                      onClick={() => setTab("equipe")}
                      className="text-link hover:underline"
                    >
                      Gérer
                    </button>
                  )}
                </div>
                <ParticipantsField
                  members={
                    isEditing
                      ? m.team.team.map((tm) => ({
                          id: tm.user_id,
                          name: personName(tm.profiles),
                          role: tm.role,
                        }))
                      : m.pendingParticipants
                  }
                  canManage={isEditing ? m.team.canManageMembers : true}
                  onAdd={(p) =>
                    isEditing
                      ? m.team.addMember(p.id, "membre")
                      : m.addPendingParticipant(p)
                  }
                  onRemove={(chip) => {
                    if (isEditing) {
                      const tm = m.team.team.find((t) => t.user_id === chip.id);
                      if (tm) m.team.removeMember(tm);
                    } else {
                      m.removePendingParticipant(chip.id);
                    }
                  }}
                  onSetResponsable={(chip) =>
                    isEditing
                      ? m.team.setResponsable(chip.id)
                      : m.setPendingResponsable(chip.id)
                  }
                />
              </div>

              <div className="flex items-center gap-2 rounded-btn border border-line px-3 py-2">
                <MapPin size={14} className="text-ink-4" />
                <input
                  ref={locationInputRef}
                  value={m.location}
                  onChange={(e) => m.setLocation(e.target.value)}
                  placeholder="Lieu"
                  className="w-full text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => m.setOnlineMeeting(!m.onlineMeeting)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    m.onlineMeeting
                      ? "border-navy bg-navy text-white"
                      : "border-line text-ink-3 hover:bg-hover"
                  }`}
                >
                  <Video size={13} /> Réunion en ligne
                </button>
              </div>

              {m.showRoute && !m.onlineMeeting && (
                <RoutePreview
                  location={m.location}
                  startISO={m.slot?.startISO ?? null}
                />
              )}

              <div className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
                <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <ClipboardCheck size={14} /> Inscriptions
                </span>
                <Toggle
                  on={m.registrationEnabled}
                  onClick={() =>
                    m.setRegistrationEnabled(!m.registrationEnabled)
                  }
                />
              </div>

              {/* Côte à côte : couverture médiatique (bleu) et comité directeur (doré) ; jours en dessous de chaque interrupteur. */}
              {(!isEditing || formDays.length > 0) && (
                <div className="grid items-start gap-3 md:grid-cols-2">
                  <div
                    className="min-w-0 space-y-2.5 rounded-btn border border-l-4 p-3"
                    style={panelStyle(COVERAGE_ACCENT)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className="flex items-center gap-1.5 text-sm font-bold"
                        style={{ color: COVERAGE_ACCENT.ink }}
                      >
                        <Camera size={14} /> Couverture médiatique
                      </span>
                      {!m.canRequestCoverage && !m.coverage.request ? (
                        <span className="text-[11px] text-ink-3">
                          Demande réservée aux organisateurs et à la coordination médias
                        </span>
                      ) : !isEditing ? (
                        <Toggle
                          on={m.wantsCoverage}
                          onClick={() => {
                            // Sans couverture, pas de jours vidéo / photo souhaités.
                            if (m.wantsCoverage)
                              m.setPresenceRequests({
                                ...m.presenceRequests,
                                video: {},
                                photo: {},
                              });
                            m.setWantsCoverage(!m.wantsCoverage);
                          }}
                        />
                      ) : m.coverage.request ? (
                        <span className="text-[11px] text-ink-3">
                          Équipe média : barre du bas
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void m.coverage.requestCoverage()}
                          className="rounded-btn px-2.5 py-1 text-[11px] font-bold text-white"
                          style={{ background: COVERAGE_ACCENT.base }}
                        >
                          Demander la couverture
                        </button>
                      )}
                    </div>
                    {!isEditing && m.wantsCoverage && (
                      <div className="space-y-2">
                        <textarea
                          value={m.coverageDetails}
                          onChange={(e) => m.setCoverageDetails(e.target.value)}
                          rows={2}
                          placeholder="Message à l'équipe média (optionnel) — photo, vidéo, angle souhaité…"
                          className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none"
                        />
                        {m.role.canAssignCoverage && (
                          <PersonPicker
                            people={m.technicians.map((t) => ({
                              id: t.id,
                              name: t.name,
                            }))}
                            selected={
                              m.coverageTechnicianId
                                ? [m.coverageTechnicianId]
                                : []
                            }
                            onChange={(ids) =>
                              m.setCoverageTechnicianId(ids[0] ?? "")
                            }
                            placeholder="Choisir un technicien"
                            noneLabel="Technicien : laisser en attente — le réseau salarié assignera"
                            emptyText="Aucun technicien disponible."
                          />
                        )}
                      </div>
                    )}
                    {formDays.length > 0 &&
                      (isEditing ? !!m.coverage.request : m.wantsCoverage) && (
                        <div className="space-y-2">
                          <DaySlotsPicker
                            label="Photo / vidéo"
                            icon={
                              <>
                                <Camera size={12} />
                                <Video size={12} />
                              </>
                            }
                            days={formDays}
                            value={{
                              ...m.presenceRequests.photo,
                              ...m.presenceRequests.video,
                            }}
                            onChange={(slots) =>
                              m.setPresenceRequests({
                                ...m.presenceRequests,
                                video: slots,
                                photo: slots,
                              })
                            }
                            accent={COVERAGE_ACCENT}
                          />
                        </div>
                      )}
                  </div>

                  <div
                    className="min-w-0 space-y-2.5 rounded-btn border border-l-4 p-3"
                    style={panelStyle(CD_ACCENT)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className="flex items-center gap-1.5 text-sm font-bold"
                        style={{ color: CD_ACCENT.ink }}
                      >
                        <Users size={14} /> Comité directeur
                      </span>
                      {!isEditing ? (
                        <Toggle
                          on={cdOpen}
                          onClick={() => {
                            // Désactivé : ni invitation ni jours souhaités pour le CD.
                            if (cdOpen) {
                              m.setPendingDirectors([]);
                              m.setPresenceRequests({
                                ...m.presenceRequests,
                                cd: {},
                              });
                            }
                            setCdOpen(!cdOpen);
                          }}
                        />
                      ) : (
                        <span className="text-[11px] text-ink-3">
                          Membres invités : barre du bas
                        </span>
                      )}
                    </div>
                    {!isEditing && cdOpen && (
                      <PersonPicker
                        multiple
                        people={m.director.directors.map((d) => ({
                          id: d.id,
                          name:
                            [d.first_name, d.last_name]
                              .filter(Boolean)
                              .join(" ") ||
                            d.email ||
                            "—",
                        }))}
                        selected={m.pendingDirectors}
                        onChange={m.setPendingDirectors}
                        placeholder="Choisir les membres à inviter"
                        emptyText="Aucun membre du comité directeur."
                      />
                    )}
                    {formDays.length > 0 && (isEditing || cdOpen) && (
                      <DaySlotsPicker
                        label="Présence souhaitée"
                        days={formDays}
                        value={m.presenceRequests.cd}
                        onChange={(cd) =>
                          m.setPresenceRequests({ ...m.presenceRequests, cd })
                        }
                        accent={CD_ACCENT}
                      />
                    )}
                    {!isEditing && cdOpen && m.pendingDirectors.length > 0 && (
                      <p className="text-[10px] text-ink-4">
                        Invitation « à confirmer » envoyée à
                        l&rsquo;enregistrement ; chacun pourra ensuite indiquer
                        d&rsquo;autres jours.
                      </p>
                    )}
                  </div>
                </div>
              )}

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

              {/* Plusieurs jours : chacun indique les jours (et heures) où il vient. */}
              {showPlanning && event && (
                <MyPresenceBar
                  eventId={event.id}
                  solicited={!!event.solicited}
                  onOpenPlanning={() => openPlanning()}
                />
              )}
              {/* Une seule journée, personne sollicitée : son créneau (11h–13h sur un 9h–17h). */}
              {!showPlanning && event?.solicited && (
                <MySingleDaySlot eventId={event.id} startISO={event.start} />
              )}
              {isEditing && <EventTeamCards eventId={event!.id} />}

              {isEditing && (
                <div>
                  <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
                    Pièces jointes
                  </div>
                  <AttachmentsField
                    eventId={event!.id}
                    eventTitle={m.title}
                    canManage={
                      m.role.canAssignCoverage || m.team.canManageMembers
                    }
                    canUpload={m.role.isTechPrestataire || m.team.isMember}
                    canPublish={m.role.canAssignCoverage}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "planning" && showPlanning && event && (
            <EventPlanningTab
              eventId={event.id}
              startISO={event.start}
              endISO={event.end}
              solicited={!!event.solicited}
              team={m.team.team}
              attendances={m.director.attendances}
              directors={m.director.directors}
              technicians={m.technicians}
              lead={
                m.coverage.request?.assigned_technician_id
                  ? {
                      id: m.coverage.request.assigned_technician_id,
                      role: m.coverage.request.technician_role ?? null,
                      accepted:
                        m.coverage.request.technician_response === "accepted",
                    }
                  : null
              }
              askMine={askMine}
            />
          )}
          {tab === "discussion" && isEditing && (
            <DiscussionTab hook={m.comments} />
          )}
          {tab === "equipe" && isEditing && <EquipeTab hook={m.team} />}
          {tab === "frais" && isEditing && event && (
            <FraisTab
              eventId={event.id}
              onDeclared={() => void m.expenses.refetch()}
            />
          )}
          {tab === "gestion" && (
            <GestionFraisTab eventId={isEditing && event ? event.id : null} />
          )}
          {tab === "fief" && isEditing && event && showFief && (
            <FiefEventShare eventId={event.id} />
          )}
          {tab === "carte" && (
            <CarteTab
              location={m.location}
              event={
                event
                  ? {
                      id: event.id,
                      title: m.title,
                      org: m.org,
                      start: m.start.toISOString(),
                    }
                  : null
              }
            />
          )}
        </div>

        {/* Pied */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-6 py-3">
          <div className="flex min-w-0 items-start gap-4">
            {isEditing && (
              <button
                onClick={m.handleDelete}
                disabled={m.saving}
                className="mt-1.5 flex shrink-0 items-center gap-1.5 text-xs font-semibold text-red hover:underline disabled:opacity-60"
              >
                <Trash2 size={13} /> Supprimer
              </button>
            )}
            {isEditing && (
              <>
                <span className="mt-1 h-6 w-px shrink-0 bg-line" aria-hidden />
                <EventCrewBar
                  eventId={event!.id}
                  role={m.role}
                  technicians={m.technicians}
                  coverage={m.coverage}
                  director={m.director}
                  requests={m.presenceRequests}
                  onJoined={showPlanning ? () => openPlanning(true) : undefined}
                />
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-btn border border-line px-4 py-2 text-sm text-ink-2"
            >
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
