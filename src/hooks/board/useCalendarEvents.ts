"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { mapEventRow, type CalendarEvent, type EventRow, type CoverageRequestRow, type PublishedMedia } from "@/lib/board/calendar";
import { readCache, writeCache } from "@/lib/board/localCache";
import { getMySolicitedEventIds } from "@/app/actions/solicitation";

/** Profil de visibilité, lu une fois par session (il ne change pas d'un changement de semaine à l'autre). */
type Access = { seeAll: boolean; solicitedOnly: boolean };
const accessByUser = new Map<string, Access>();

/** Spécialités qui ne voient que les événements où elles sont sollicitées. */
const SOLICITED_ONLY_SPECIALTIES = ["tech-prestataire", "tech-benevole"];

/**
 * Événements de la plage, selon le profil :
 * - administrateurs : tout ;
 * - prestataires et bénévoles techniques : uniquement les événements où ils sont sollicités ;
 * - tous les autres : tous les événements de la Ligue (l'icône « où je suis sollicité » filtre),
 *   les événements personnels (sans organisation, visibilité « private ») restant réservés à leurs
 *   participants.
 */
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

    let access = accessByUser.get(user.id);
    if (!access) {
      const [{ data: profile }, { data: specs }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).single(),
        supabase.from("profile_specialties").select("specialties(slug)").eq("user_id", user.id),
      ]);
      const slugs = ((specs ?? []) as unknown as { specialties: { slug: string } | null }[]).map((r) => r.specialties?.slug ?? "");
      const seeAll = profile?.role === "admin" || profile?.role === "super_user";
      access = { seeAll, solicitedOnly: !seeAll && slugs.some((s) => SOLICITED_ONLY_SPECIALTIES.includes(s)) };
      accessByUser.set(user.id, access);
    }

    const baseSelect =
      "id, title, event_type, start_date, end_date, location, online_meeting, registration_enabled, organizer_message, requires_coverage, created_by, created_at, updated_by, updated_at, status, visibility";
    const inRange = () =>
      supabase
        .from("events")
        .select(baseSelect)
        .gte("start_date", startISO)
        .lte("start_date", endISO)
        .neq("visibility", "hidden")
        .eq("show_in_calendar", true)
        .order("start_date");

    let rows: EventRow[] = [];
    // Sollicitations (équipe, affectation, captation, comité directeur) : filtre, icône et droits.
    const solicitedIds = await getMySolicitedEventIds().catch(() => [] as string[]);

    if (access.seeAll) {
      const { data, error } = await inRange();
      if (error) console.error("[useCalendarEvents]", error);
      rows = (data as EventRow[] | null) ?? [];
    } else {
      const [{ data: teamLinks }, { data: assignments }, { data: ownEvents }] = await Promise.all([
        supabase.from("event_team_members").select("event_id").eq("user_id", user.id),
        supabase.from("event_assignments").select("event_id").eq("user_id", user.id),
        supabase.from("events").select("id").eq("created_by", user.id),
      ]);
      const mine = new Set([
        ...solicitedIds,
        ...((teamLinks ?? []) as { event_id: string }[]).map((e) => e.event_id),
        ...((assignments ?? []) as { event_id: string }[]).map((a) => a.event_id),
        ...((ownEvents ?? []) as { id: string }[]).map((e) => e.id),
      ]);

      if (access.solicitedOnly) {
        if (mine.size > 0) {
          const { data, error } = await inRange().in("id", [...mine]);
          if (error) console.error("[useCalendarEvents]", error);
          rows = (data as EventRow[] | null) ?? [];
        }
      } else {
        const { data, error } = await inRange();
        if (error) console.error("[useCalendarEvents]", error);
        rows = ((data ?? []) as (EventRow & { visibility?: string | null })[]).filter((r) => r.visibility !== "private" || mine.has(r.id));
      }
    }

    let coverageByEvent = new Map<string, CoverageRequestRow>();
    const publishedByEvent = new Map<string, PublishedMedia>();
    let photoCovered = new Set<string>();
    const eventIds = rows.map((r) => r.id);
    if (eventIds.length > 0) {
      const [{ data: coverageRows }, { data: publishedRows }, { data: photoRows }] = await Promise.all([
        supabase
          .from("coverage_requests")
          .select("event_id, status, coverage_symbol, technician_response, assigned_technician_id")
          .in("event_id", eventIds)
          .order("created_at", { ascending: false }),
        // Médias de l'événement publiés sur les réseaux → sigle entouré dans le calendrier.
        supabase.from("media_publications").select("event_id, kind").eq("status", "published").in("event_id", eventIds),
        // Postes photo des matchs (filtre CouvPhoto).
        supabase.from("photo_missions").select("event_id").in("event_id", eventIds),
      ]);
      photoCovered = new Set((photoRows ?? []).map((p) => p.event_id));
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

    const solicited = new Set(solicitedIds);
    const mapped = rows.map((row) => ({
      ...mapEventRow(row, coverageByEvent.get(row.id)),
      published: publishedByEvent.get(row.id) ?? null,
      weekendMatch: row.event_type === "match_du_week_end",
      photoCoverage: photoCovered.has(row.id),
      solicited: solicited.has(row.id),
      awaitingMyAnswer: (() => {
        const c = coverageByEvent.get(row.id);
        return !!c && c.assigned_technician_id === user.id && c.status !== "rejected" && c.technician_response !== "accepted" && c.technician_response !== "rejected";
      })(),
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
      .on("postgres_changes", { event: "*", schema: "public", table: "photo_missions" }, () => fetchEvents())
      // Participants / assignations : l'icône « où je suis sollicité » suit sans rechargement.
      .on("postgres_changes", { event: "*", schema: "public", table: "event_team_members" }, () => fetchEvents())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_assignments" }, () => fetchEvents())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchEvents]);

  return { events, loading, refetch: fetchEvents };
}
