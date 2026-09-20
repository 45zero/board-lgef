"use client";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { DbEventType } from "@/lib/board/calendar";
import { syncEventToGoogle, removeEventFromGoogle } from "@/app/actions/calendar-sync";

export interface EventFormPayload {
  title: string;
  eventType: DbEventType;
  location: string;
  onlineMeeting: boolean;
  message: string;
  startISO: string;
  endISO: string;
}

/** CRUD événement interne — création/édition portées de EventModal.tsx, suppression en cascade de useEvents.ts (deleteEvent). */
export function useEventActions() {
  const { user } = useAuth();

  const createEvent = async (payload: EventFormPayload) => {
    if (!user) return null;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("events")
      .insert({
        title: payload.title,
        event_type: payload.eventType,
        location: payload.location || null,
        online_meeting: payload.onlineMeeting,
        organizer_message: payload.message || null,
        start_date: payload.startISO,
        end_date: payload.endISO,
        organizer_id: user.id,
        created_by: user.id,
        status: "pending",
        show_in_calendar: true,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[useEventActions.createEvent]", error);
      return null;
    }
    const eventId = data.id as string;
    // Miroir Google Calendar best-effort — ne bloque jamais la création board.
    syncEventToGoogle(eventId).catch((err) => console.error("[useEventActions.createEvent] sync Google", err));
    return eventId;
  };

  const updateEvent = async (id: string, payload: EventFormPayload) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("events")
      .update({
        title: payload.title,
        event_type: payload.eventType,
        location: payload.location || null,
        online_meeting: payload.onlineMeeting,
        organizer_message: payload.message || null,
        start_date: payload.startISO,
        end_date: payload.endISO,
      })
      .eq("id", id);
    if (!error) {
      syncEventToGoogle(id).catch((err) => console.error("[useEventActions.updateEvent] sync Google", err));
    }
    return !error;
  };

  /** Suppression en cascade — ces FK ne sont pas ON DELETE CASCADE côté base. */
  const deleteEventCascade = async (id: string) => {
    const supabase = createClient();
    // Doit lire l'événement (google_event_id) avant sa suppression board ci-dessous.
    await removeEventFromGoogle(id).catch((err) => console.error("[useEventActions.deleteEventCascade] sync Google", err));
    try {
      const { data: submissions } = await supabase
        .from("expense_submissions")
        .select("id, expense_ids")
        .eq("event_id", id);

      if (submissions?.length) {
        for (const submission of submissions) {
          if (submission.expense_ids?.length) {
            await supabase.from("expense_documents").delete().in("expense_id", submission.expense_ids);
          }
        }
      }

      await supabase.from("expense_submissions").delete().eq("event_id", id);
      await supabase.from("event_expenses").delete().eq("event_id", id);
      await supabase.from("coverage_requests").delete().eq("event_id", id);
      await supabase.from("assignments").delete().eq("event_id", id);
      await supabase.from("director_attendance").delete().eq("event_id", id);
      await supabase.from("event_assignments").delete().eq("event_id", id);
      await supabase.from("event_team_members").delete().eq("event_id", id);
      await supabase.from("event_comments").delete().eq("event_id", id);
      await supabase.from("event_reminders").delete().eq("event_id", id);
      await supabase.from("event_files").delete().eq("event_id", id);

      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[useEventActions.deleteEventCascade]", err);
      return false;
    }
  };

  return { createEvent, updateEvent, deleteEventCascade };
}
