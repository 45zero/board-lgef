"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mapEventRow, type CalendarEvent, type EventRow, type CoverageRequestRow, type PublishedMedia } from "@/lib/board/calendar";
import { readCache, writeCache } from "@/lib/board/localCache";
import { getMySolicitedEventIds } from "@/app/actions/solicitation";

/** Rôle de l'utilisateur, lu une fois par session (il ne change pas d'un changement de semaine à l'autre). */
const roleByUser = new Map<string, string | null>();

/** Porté de calendrier-lgef/src/hooks/useEvents.ts, généralisé du mois à une plage libre (semaine). */
export function useCalendarEvents(rangeStart: Date, rangeEnd: Date) {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!user) return;

    const supabase = createClient();
    const startISO = rangeStart.toISOString();
    const endISO = rangeEnd.toISOString();

    // Affichage instantané de la dernière version connue de cette plage, rafraîchie juste après.
    const cacheKey = `cal:${user.id}:${startISO}:${endISO}`;
    const cached = readCache<CalendarEvent[]>(cacheKey);
    if (cached) {
      setEvents(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let role = roleByUser.get(user.id);
    if (role === undefined) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      role = profile?.role ?? null;
      roleByUser.set(user.id, role);
    }

    const baseSelect =
      "id, title, event_type, start_date, end_date, location, online_meeting, registration_enabled, organizer_message, requires_coverage, created_by, created_at, updated_by, updated_at, status";

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
    const publishedByEvent = new Map<string, PublishedMedia>();
    const eventIds = rows.map((r) => r.id);
    if (eventIds.length > 0) {
      const [{ data: coverageRows }, { data: publishedRows }] = await Promise.all([
        supabase
          .from("coverage_requests")
          .select("event_id, status, coverage_symbol, technician_response")
          .in("event_id", eventIds)
          .order("created_at", { ascending: false }),
        // Médias de l'événement publiés sur les réseaux → sigle entouré dans le calendrier.
        supabase.from("media_publications").select("event_id, kind").eq("status", "published").in("event_id", eventIds),
      ]);
      for (const p of publishedRows ?? []) {
        if (!p.event_id) continue;
        const kind: PublishedMedia = p.kind === "video" ? "video" : "photo";
        const prev = publishedByEvent.get(p.event_id);
        publishedByEvent.set(p.event_id, prev && prev !== kind ? "both" : kind);
      }
      coverageByEvent = new Map(
        ((coverageRows as CoverageRequestRow[] | null) ?? [])
          .filter((r) => r.event_id)
          .map((r) => [r.event_id as string, r])
      );
    }

    const solicited = new Set(await getMySolicitedEventIds().catch(() => [] as string[]));
    const mapped = rows.map((row) => ({
      ...mapEventRow(row, coverageByEvent.get(row.id)),
      published: publishedByEvent.get(row.id) ?? null,
      solicited: solicited.has(row.id),
    }));
    setEvents(mapped);
    writeCache(cacheKey, mapped);
    setLoading(false);
  }, [user, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Live : la grille (couleurs/icônes de couverture, statuts) se met à jour
  // sans rechargement dès qu'un événement ou une demande de couverture change,
  // même quand aucun modal n'est ouvert.
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`calendar-events-live-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => fetchEvents())
      .on("postgres_changes", { event: "*", schema: "public", table: "coverage_requests" }, () => fetchEvents())
      .on("postgres_changes", { event: "*", schema: "public", table: "director_attendance" }, () => fetchEvents())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchEvents]);

  return { events, loading, refetch: fetchEvents };
}
