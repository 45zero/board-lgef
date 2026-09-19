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
import { useAvailableTechnicians } from "@/hooks/board/useAvailableTechnicians";
import { useEventCoverage } from "@/hooks/board/useEventCoverage";

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

  const [org, setOrg] = useState<Exclude<OrgKey, "perso">>(
    (event?.org as Exclude<OrgKey, "perso">) ?? "navy"
  );
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
  const role = useUserRole();
  const { technicians } = useAvailableTechnicians();
  const coverage = useEventCoverage(event?.id);

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

  return {
    isEditing,
    org,
    setOrg,
    title,
    setTitle,
    location,
    setLocation,
    message,
    setMessage,
    start,
    dateStr,
    setDateStr,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    saving,
    reminderOn,
    toggleReminder,
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
