"use client";

import { notifyEventAssignment } from "@/app/actions/event-notifications";
import { useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyRequests, requestCount, requestsFromRows, type PresenceRequests } from "@/lib/board/presence";
import { savePresenceRequests } from "@/app/actions/event-presence";
import { useAuth } from "@/contexts/AuthContext";
import { ORG_TO_EVENT_TYPE, type CalendarEvent } from "@/lib/board/calendar";
import type { OrgKey } from "@/lib/board/tokens";
import { useEventTeam } from "@/hooks/board/useEventTeam";
import { useDirectorAttendance } from "@/hooks/board/useDirectorAttendance";
import { useEventComments } from "@/hooks/board/useEventComments";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import { useEventActions, type EventFormPayload } from "@/hooks/board/useEventActions";
import { useUserRole } from "@/hooks/board/useUserRole";
import { useCreatableOrgs } from "@/hooks/board/useCreatableOrgs";
import { useNotificationPreferences } from "@/hooks/board/useNotificationPreferences";
import { useAvailableTechnicians } from "@/hooks/board/useAvailableTechnicians";
import { useEventCoverage } from "@/hooks/board/useEventCoverage";
import type { EventDraft } from "@/app/actions/event-dictation";
import { getMyDepartureAt } from "@/app/actions/my-schedule";

/** Préréglages de rappel façon Google Agenda — doit rester synchro avec la
 * contrainte CHECK sur event_reminders.reminder_offset (« depart » : sql/2026-10-14_departure_reminders.sql). */
export const REMINDER_PRESETS: { value: string; label: string }[] = [
  { value: "0min", label: "À l'heure de l'événement" },
  { value: "depart", label: "Au moment du départ (trajet)" },
  { value: "10min", label: "10 minutes avant" },
  { value: "20min", label: "20 minutes avant" },
  { value: "30min", label: "30 minutes avant" },
  { value: "1h", label: "1 heure avant" },
  { value: "2h", label: "2 heures avant" },
  { value: "1d", label: "1 jour avant" },
];

const REMINDER_OFFSET_MINUTES: Record<string, number> = {
  "0min": 0,
  "10min": 10,
  "20min": 20,
  "30min": 30,
  "1h": 60,
  "2h": 120,
  "1d": 1440,
};

/**
 * Heure d'envoi d'un rappel. « depart » : début − temps de route depuis le domicile − marge
 * (null sans adresse au profil ou sans lieu joignable en voiture).
 */
async function remindAt(offset: string, startISO: string, location: string): Promise<string | null> {
  if (offset === "depart") return location.trim() ? getMyDepartureAt(location, startISO).catch(() => null) : null;
  return new Date(new Date(startISO).getTime() - (REMINDER_OFFSET_MINUTES[offset] ?? 0) * 60_000).toISOString();
}

const NO_DEPARTURE =
  "Rappel de départ impossible : renseignez le lieu de l'événement et votre adresse dans votre profil (itinéraire en voiture).";

/** Début du brouillon dicté (date du jour + heure dite, 09:00 sans heure ; rien sans date). */
function draftStart(d: EventDraft | null) {
  if (!d?.date) return null;
  return new Date(`${d.date}T${d.startTime ?? "09:00"}:00`);
}

/** Fin du brouillon dicté : heure de fin dite si elle suit le début, sinon une heure plus tard. */
function draftEnd(d: EventDraft | null) {
  const s = draftStart(d);
  if (!s) return null;
  const e = d!.endTime ? new Date(`${d!.date}T${d!.endTime}:00`) : null;
  return e && e > s ? e : new Date(s.getTime() + 3600_000);
}

/** État + logique partagés entre EventModal (bureau) et MobileEventModal. */
export function useEventModalState({
  event,
  defaultStart,
  defaultEnd,
  draft,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  defaultStart?: Date;
  defaultEnd?: Date;
  /** Brouillon dicté (création à la voix) : pré-remplit la fiche d'un nouvel événement. */
  draft?: EventDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const isEditing = !!event;
  const d = event ? null : draft ?? null;

  const [org, setOrg] = useState<OrgKey>(event?.org ?? d?.org ?? "navy");
  // Services proposés : ceux où la personne peut créer (Perso + ses pôles ; tous pour un admin).
  // En modification, le service actuel reste toujours affiché.
  const creatableOrgs = useCreatableOrgs();
  const currentOrg = event?.org;
  const orgOptions = useMemo(
    () => (creatableOrgs && currentOrg && !creatableOrgs.includes(currentOrg) ? [currentOrg, ...creatableOrgs] : creatableOrgs),
    [creatableOrgs, currentOrg]
  );
  // Nouvel événement : le service par défaut (ou dicté) n'est pas permis → premier service permis.
  useEffect(() => {
    if (isEditing || !orgOptions || orgOptions.includes(org)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- corrige le défaut une fois les droits chargés
    setOrg(orgOptions.find((k) => k !== "perso") ?? orgOptions[0]);
  }, [isEditing, orgOptions, org]);
  const [title, setTitle] = useState(event?.title ?? d?.title ?? "");
  const [location, setLocation] = useState(event?.location ?? d?.location ?? "");
  const [onlineMeeting, setOnlineMeeting] = useState(event?.onlineMeeting ?? d?.onlineMeeting ?? false);
  const [registrationEnabled, setRegistrationEnabled] = useState(event?.registrationEnabled ?? false);
  const [message, setMessage] = useState(event?.message ?? d?.message ?? "");
  const [pendingParticipants, setPendingParticipants] = useState<
    { id: string; name: string; role: "responsable" | "membre" }[]
  >(d?.participants ?? []);
  const [pendingReminders, setPendingReminders] = useState<string[]>(d?.reminders ?? []);
  const start = event ? parseISO(event.start) : draftStart(d) ?? defaultStart ?? new Date();
  const end = event ? parseISO(event.end) : draftEnd(d) ?? defaultEnd ?? new Date(start.getTime() + 3600_000);
  const [dateStr, setDateStr] = useState(format(start, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(end, "HH:mm"));
  // Jours entre début et fin (événement sur plusieurs jours) : changer la date de début décale la fin d'autant.
  const [endDayOffset, setEndDayOffset] = useState(() => Math.max(0, differenceInCalendarDays(end, start)));
  const endDateStr = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? format(addDays(new Date(`${dateStr}T12:00:00`), endDayOffset), "yyyy-MM-dd") : dateStr;
  /** Date de fin choisie : jamais avant la date de début. */
  const setEndDateStr = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    setEndDayOffset(Math.max(0, differenceInCalendarDays(new Date(`${next}T12:00:00`), new Date(`${dateStr}T12:00:00`))));
  };
  // Présences souhaitées (vidéo, photo, CD) jour par jour — événement de plusieurs jours.
  const [presenceRequests, setPresenceRequestsState] = useState<PresenceRequests>(emptyRequests);
  const [requestsDirty, setRequestsDirty] = useState(false);
  // Création : membres du comité directeur à inviter (invitation « à confirmer » à l'enregistrement).
  const [pendingDirectors, setPendingDirectors] = useState<string[]>([]);
  const setPresenceRequests = (next: PresenceRequests) => {
    setPresenceRequestsState(next);
    setRequestsDirty(true);
  };
  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    (createClient() as unknown as SupabaseClient)
      .from("event_presence_requests")
      .select("kind, day, start_time, end_time")
      .eq("event_id", event.id)
      .then(({ data }) => {
        if (!cancelled && data) setPresenceRequestsState(requestsFromRows(data as { kind: string; day: string; start_time: string | null; end_time: string | null }[]));
      });
    return () => {
      cancelled = true;
    };
  }, [event?.id]);
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState<{ id: string; reminder_offset: string }[]>([]);
  const [wantsCoverage, setWantsCoverage] = useState(d?.wantsCoverage ?? false);
  const [coverageDetails, setCoverageDetails] = useState(d?.coverageDetails ?? "");
  const [coverageTechnicianId, setCoverageTechnicianId] = useState(d?.coverageAssignee?.id ?? "");

  const { createEvent, updateEvent, deleteEventCascade } = useEventActions();
  const team = useEventTeam(event?.id ?? "", event?.createdBy ?? null);
  const director = useDirectorAttendance(event?.id);
  const comments = useEventComments(event?.id ?? "");
  const expenses = useEventExpenses(event?.id ?? "");
  const role = useUserRole();
  const { technicians } = useAvailableTechnicians();
  const coverage = useEventCoverage(event?.id);
  const notifPrefs = useNotificationPreferences();

  useEffect(() => {
    if (!event) return;
    const supabase = createClient();
    supabase
      .from("event_reminders")
      .select("id, reminder_offset")
      .eq("event_id", event.id)
      .eq("user_id", user?.id ?? "")
      .then(({ data }) => setReminders(data ?? []));
  }, [event, user?.id]);

  const addReminder = async (offset: string) => {
    if (!event || !user || reminders.some((r) => r.reminder_offset === offset)) return;
    const at = await remindAt(offset, event.start, event.onlineMeeting ? "" : event.location);
    if (!at) {
      window.alert(NO_DEPARTURE);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("event_reminders")
      .insert({
        event_id: event.id,
        user_id: user.id,
        remind_at: at,
        reminder_offset: offset,
        channels: [
          "app",
          ...(notifPrefs.notifyEmail ? ["email"] : []),
          ...(notifPrefs.notifyPush ? ["push"] : []),
        ],
      })
      .select("id, reminder_offset")
      .single();
    if (data) setReminders((prev) => [...prev, data]);
  };

  const removeReminder = async (id: string) => {
    const supabase = createClient();
    await supabase.from("event_reminders").delete().eq("id", id);
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  /** Heure ou lieu modifiés : mes rappels pas encore envoyés suivent (le départ dépend aussi du lieu). */
  const rescheduleMyReminders = async (eventId: string, startISO: string) => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("event_reminders")
      .select("id, reminder_offset, remind_at")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .is("sent_at", null);
    await Promise.all(
      (data ?? []).map(async (r) => {
        const at = await remindAt(r.reminder_offset, startISO, onlineMeeting ? "" : location);
        if (at && at !== r.remind_at) await supabase.from("event_reminders").update({ remind_at: at }).eq("id", r.id);
      })
    );
  };

  /** Changer l'heure de début décale la fin d'autant (durée conservée). */
  const changeStartTime = (next: string) => {
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    if (/^\d{2}:\d{2}$/.test(next) && /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime)) {
      const duration = (toMin(endTime) - toMin(startTime) + 1440) % 1440;
      const endMin = (toMin(next) + duration) % 1440;
      setEndTime(`${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`);
    }
    setStartTime(next);
  };

  /** Créneau saisi (null tant que la date ou une heure est incomplète). */
  const slot = (() => {
    const startAt = new Date(`${dateStr}T${startTime}:00`);
    let endAt = addDays(new Date(`${dateStr}T${endTime}:00`), endDayOffset);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return null;
    // Fin avant le début (ex. 23:00 → 00:30) : l'événement se termine le lendemain.
    if (endAt < startAt) endAt = addDays(endAt, 1);
    return { startISO: startAt.toISOString(), endISO: endAt.toISOString() };
  })();

  const buildPayload = (): EventFormPayload => {
    if (!slot) throw new Error("Date ou heure invalide");
    const { startISO, endISO } = slot;
    return {
      title,
      eventType: ORG_TO_EVENT_TYPE[org],
      location,
      onlineMeeting,
      registrationEnabled,
      message,
      startISO,
      endISO,
    };
  };

  const addPendingParticipant = (profile: { id: string; first_name: string | null; last_name: string | null; email: string | null }) => {
    if (pendingParticipants.some((p) => p.id === profile.id)) return;
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.email || "—";
    setPendingParticipants((prev) => [...prev, { id: profile.id, name, role: "membre" }]);
  };

  const removePendingParticipant = (id: string) => {
    setPendingParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const setPendingResponsable = (id: string) => {
    setPendingParticipants((prev) => prev.map((p) => ({ ...p, role: p.id === id ? "responsable" : "membre" })));
  };

  const addPendingReminder = (offset: string) => {
    setPendingReminders((prev) => (prev.includes(offset) ? prev : [...prev, offset]));
  };

  const removePendingReminder = (offset: string) => {
    setPendingReminders((prev) => prev.filter((o) => o !== offset));
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEditing && event) {
        const ok = await updateEvent(event.id, payload);
        if (ok) {
          await rescheduleMyReminders(event.id, payload.startISO);
          if (requestsDirty) {
            const res = await savePresenceRequests(event.id, presenceRequests, payload.startISO, payload.endISO);
            if (res.error) alert(`Présences souhaitées non enregistrées : ${res.error}`);
          }
          onSaved();
          onClose();
        }
        return;
      }

      const newId = await createEvent(payload);
      if (!newId) return;

      // Invitations du comité directeur : même circuit que l'ajout depuis la fiche (notification, réponse).
      if (pendingDirectors.length > 0 && user) {
        const { error: cdError } = await createClient()
          .from("director_attendance")
          .insert(pendingDirectors.map((id) => ({ event_id: newId, director_id: id, status: "pending", created_by: user.id, updated_by: user.id })));
        if (cdError) console.error("[handleSave.directors]", cdError.message);
      }
      if (requestCount(presenceRequests) > 0) {
        const res = await savePresenceRequests(newId, presenceRequests, payload.startISO, payload.endISO);
        if (res.error) alert(`Présences souhaitées non enregistrées : ${res.error}`);
      }

      if (pendingParticipants.length > 0) {
        const supabase = createClient();
        const { error: teamError } = await supabase.from("event_team_members").insert(
          pendingParticipants.map((p) => ({ event_id: newId, user_id: p.id, role: p.role }))
        );
        if (!teamError) {
          for (const role of ["responsable", "membre"] as const) {
            const ids = pendingParticipants.filter((p) => p.role === role).map((p) => p.id);
            if (ids.length) void notifyEventAssignment(newId, ids, role);
          }
        }
      }

      if (pendingReminders.length > 0 && user) {
        const supabase = createClient();
        const channels = [
          "app",
          ...(notifPrefs.notifyEmail ? ["email"] : []),
          ...(notifPrefs.notifyPush ? ["push"] : []),
        ];
        const rows = await Promise.all(
          pendingReminders.map(async (offset) => ({
            event_id: newId,
            user_id: user.id,
            remind_at: await remindAt(offset, payload.startISO, payload.onlineMeeting ? "" : payload.location),
            reminder_offset: offset,
            channels,
          }))
        );
        const valid = rows.filter((r): r is typeof r & { remind_at: string } => !!r.remind_at);
        if (valid.length) await supabase.from("event_reminders").insert(valid);
        if (valid.length < rows.length) window.alert(NO_DEPARTURE);
      }

      if (wantsCoverage && user) {
        // useEventCoverage est lié à event?.id (indéfini à la création) — on ne peut
        // pas le réutiliser ici, donc écriture directe avec le nouvel id.
        const supabase = createClient();
        const tech = role.canAssignCoverage ? technicians.find((t) => t.id === coverageTechnicianId) : undefined;
        try {
          if (tech) {
            await supabase.from("coverage_requests").insert({
              event_id: newId,
              requester_id: user.id,
              assigned_technician_id: tech.id,
              technician_id: tech.id,
              assigned_technician_name: tech.name,
              assigned_technician_email: tech.email,
              technician_response: "accepted",
              status: "approved",
            });
          } else {
            await supabase.from("coverage_requests").insert({
              event_id: newId,
              requester_id: user.id,
              status: "pending",
              details: coverageDetails.trim() || null,
            });
          }
          await supabase.from("events").update({ requires_coverage: true }).eq("id", newId);
        } catch (e) {
          console.warn("[useEventModalState] coverage request failed", e);
        }
      }

      onSaved();
      onClose();
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

  return {
    isEditing,
    draft: d,
    org,
    setOrg,
    orgOptions,
    title,
    setTitle,
    location,
    setLocation,
    onlineMeeting,
    setOnlineMeeting,
    registrationEnabled,
    setRegistrationEnabled,
    message,
    setMessage,
    pendingParticipants,
    addPendingParticipant,
    removePendingParticipant,
    setPendingResponsable,
    start,
    dateStr,
    setDateStr,
    endDateStr,
    setEndDateStr,
    endDayOffset,
    presenceRequests,
    setPresenceRequests,
    pendingDirectors,
    setPendingDirectors,
    startTime,
    setStartTime: changeStartTime,
    endTime,
    setEndTime,
    slot,
    // Itinéraire depuis le domicile : à la création, ou pour un membre de l'événement (équipe, assigné, captation…).
    showRoute: !isEditing || !!event?.solicited || team.team.some((t) => t.user_id === user?.id),
    saving,
    reminders,
    addReminder,
    removeReminder,
    pendingReminders,
    addPendingReminder,
    removePendingReminder,
    wantsCoverage,
    setWantsCoverage,
    coverageDetails,
    setCoverageDetails,
    coverageTechnicianId,
    setCoverageTechnicianId,
    team,
    director,
    comments,
    expenses,
    role,
    technicians,
    coverage,
    handleSave,
    handleDelete,
  };
}
