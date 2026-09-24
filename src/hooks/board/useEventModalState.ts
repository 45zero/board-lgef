"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ORG_TO_EVENT_TYPE, type CalendarEvent } from "@/lib/board/calendar";
import type { OrgKey } from "@/lib/board/tokens";
import { useEventTeam } from "@/hooks/board/useEventTeam";
import { useDirectorAttendance } from "@/hooks/board/useDirectorAttendance";
import { useEventComments } from "@/hooks/board/useEventComments";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import { useEventActions, type EventFormPayload } from "@/hooks/board/useEventActions";
import { useUserRole } from "@/hooks/board/useUserRole";
import { useNotificationPreferences } from "@/hooks/board/useNotificationPreferences";
import { useAvailableTechnicians } from "@/hooks/board/useAvailableTechnicians";
import { useEventCoverage } from "@/hooks/board/useEventCoverage";

/** Préréglages de rappel façon Google Agenda — doit rester synchro avec la
 * contrainte CHECK sur event_reminders.reminder_offset. */
export const REMINDER_PRESETS: { value: string; label: string }[] = [
  { value: "0min", label: "À l'heure de l'événement" },
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

/** État + logique partagés entre EventModal (bureau) et MobileEventModal. */
export function useEventModalState({
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

  const [org, setOrg] = useState<OrgKey>(event?.org ?? "navy");
  const [title, setTitle] = useState(event?.title ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [onlineMeeting, setOnlineMeeting] = useState(event?.onlineMeeting ?? false);
  const [registrationEnabled, setRegistrationEnabled] = useState(event?.registrationEnabled ?? false);
  const [message, setMessage] = useState(event?.message ?? "");
  const [pendingParticipants, setPendingParticipants] = useState<
    { id: string; name: string; role: "responsable" | "membre" }[]
  >([]);
  const [pendingReminders, setPendingReminders] = useState<string[]>([]);
  const start = event ? parseISO(event.start) : defaultStart ?? new Date();
  const end = event ? parseISO(event.end) : defaultEnd ?? new Date(Date.now() + 3600_000);
  const [dateStr, setDateStr] = useState(format(start, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(format(start, "HH:mm"));
  const [endTime, setEndTime] = useState(format(end, "HH:mm"));
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState<{ id: string; reminder_offset: string }[]>([]);
  const [wantsCoverage, setWantsCoverage] = useState(false);
  const [coverageDetails, setCoverageDetails] = useState("");
  const [coverageTechnicianId, setCoverageTechnicianId] = useState("");

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
    const supabase = createClient();
    const remindAt = new Date(parseISO(event.start).getTime() - REMINDER_OFFSET_MINUTES[offset] * 60_000);
    const { data } = await supabase
      .from("event_reminders")
      .insert({
        event_id: event.id,
        user_id: user.id,
        remind_at: remindAt.toISOString(),
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

  const buildPayload = (): EventFormPayload => {
    const startISO = new Date(`${dateStr}T${startTime}:00`).toISOString();
    const endISO = new Date(`${dateStr}T${endTime}:00`).toISOString();
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
          onSaved();
          onClose();
        }
        return;
      }

      const newId = await createEvent(payload);
      if (!newId) return;

      if (pendingParticipants.length > 0) {
        const supabase = createClient();
        await supabase.from("event_team_members").insert(
          pendingParticipants.map((p) => ({ event_id: newId, user_id: p.id, role: p.role }))
        );
      }

      if (pendingReminders.length > 0 && user) {
        const supabase = createClient();
        const startMs = new Date(payload.startISO).getTime();
        const channels = [
          "app",
          ...(notifPrefs.notifyEmail ? ["email"] : []),
          ...(notifPrefs.notifyPush ? ["push"] : []),
        ];
        await supabase.from("event_reminders").insert(
          pendingReminders.map((offset) => ({
            event_id: newId,
            user_id: user.id,
            remind_at: new Date(startMs - REMINDER_OFFSET_MINUTES[offset] * 60_000).toISOString(),
            reminder_offset: offset,
            channels,
          }))
        );
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
    org,
    setOrg,
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
    startTime,
    setStartTime,
    endTime,
    setEndTime,
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
