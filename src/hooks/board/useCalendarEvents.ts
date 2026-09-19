"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mapEventRow, type CalendarEvent, type EventRow, type CoverageRequestRow } from "@/lib/board/calendar";

/** Porté de calendrier-lgef/src/hooks/useEvents.ts, généralisé du mois à une plage libre (semaine). */
export function useCalendarEvents(rangeStart: Date, rangeEnd: Date) {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const supabase = createClient();
    const startISO = rangeStart.toISOString();
    const endISO = rangeEnd.toISOString();

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const role = profile?.role;

    const baseSelect =
      "id, title, event_type, start_date, end_date, location, organizer_message, requires_coverage, created_by, created_at, status";

    let rows: EventRow[] = [];

    if (role === "admin" || role === "super_user") {
      const { data, error } = await supabase
        .from("events")
        .select(baseSelect)
        .gte("start_date", startISO)
        .lte("start_date", endISO)
        .neq("visibility", "hidden")
        .eq("show_in_calendar", true)
        .order("start_date");
      if (error) console.error("[useCalendarEvents]", error);
      rows = (data as EventRow[] | null) ?? [];
    } else {
      const [{ data: teamLinks }, { data: assignments }, { data: ownEvents }] = await Promise.all([
        supabase.from("event_team_members").select("event_id").eq("user_id", user.id),
        supabase.from("event_assignments").select("event_id").eq("user_id", user.id),
        supabase.from("events").select("id").eq("created_by", user.id),
      ]);

      const allEventIds = [
        ...new Set([
          ...((teamLinks ?? []) as { event_id: string }[]).map((e) => e.event_id),
          ...((assignments ?? []) as { event_id: string }[]).map((a) => a.event_id),
          ...((ownEvents ?? []) as { id: string }[]).map((e) => e.id),
        ]),
      ];

      if (allEventIds.length > 0) {
        const { data, error } = await supabase
          .from("events")
          .select(baseSelect)
          .in("id", allEventIds)
          .gte("start_date", startISO)
          .lte("start_date", endISO)
          .neq("visibility", "hidden")
          .eq("show_in_calendar", true)
          .order("start_date");
        if (error) console.error("[useCalendarEvents]", error);
        rows = (data as EventRow[] | null) ?? [];
      }
    }

    let coverageByEvent = new Map<string, CoverageRequestRow>();
    const eventIds = rows.map((r) => r.id);
    if (eventIds.length > 0) {
      const { data: coverageRows } = await supabase
        .from("coverage_requests")
        .select("event_id, status, coverage_symbol, technician_response")
        .in("event_id", eventIds)
        .order("created_at", { ascending: false });
      coverageByEvent = new Map(
        ((coverageRows as CoverageRequestRow[] | null) ?? [])
          .filter((r) => r.event_id)
          .map((r) => [r.event_id as string, r])
      );
    }

    setEvents(rows.map((row) => mapEventRow(row, coverageByEvent.get(row.id))));
    setLoading(false);
  }, [user, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, refetch: fetchEvents };
}
