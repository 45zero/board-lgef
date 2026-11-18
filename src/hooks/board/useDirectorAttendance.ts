"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DirectorAttendance {
  id: string;
  event_id: string;
  director_id: string | null;
  status: string | null;
  comments: string | null;
}

export interface DirectorProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

/**
 * Membres du comité directeur sollicités sur un événement — plusieurs possibles, une ligne
 * director_attendance par membre (unicité événement + membre, sql/2026-11-18_event_crew.sql).
 * Les notifications (membre sollicité, réponse au créateur, aux responsables et au N+1, transfert à
 * un autre membre) partent du trigger notify_director_attendance.
 */
export function useDirectorAttendance(eventId?: string) {
  const [attendances, setAttendances] = useState<DirectorAttendance[]>([]);
  const [directors, setDirectors] = useState<DirectorProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const fetchAttendance = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    const { data } = await createClient()
      .from("director_attendance")
      .select("id, event_id, director_id, status, comments")
      .eq("event_id", id)
      .not("director_id", "is", null)
      .order("created_at");
    setAttendances((data as DirectorAttendance[] | null) ?? []);
    setLoading(false);
  }, []);

  /** Ma sollicitation sur cet événement (pour répondre), sinon null. */
  const mine = useMemo(() => attendances.find((a) => a.director_id === user?.id) ?? null, [attendances, user?.id]);
  /** Membres pas encore sollicités : candidats à l'ajout ou au transfert. */
  const freeDirectors = useMemo(() => directors.filter((d) => !attendances.some((a) => a.director_id === d.id)), [directors, attendances]);

  /** Sollicite un membre de plus — laissé « en attente » pour qu'il confirme lui-même, et notifié. */
  const addDirector = async (directorId: string) => {
    if (!user || !eventId || attendances.some((a) => a.director_id === directorId)) return false;
    const { error } = await createClient()
      .from("director_attendance")
      .insert({ event_id: eventId, director_id: directorId, status: "pending", created_by: user.id, updated_by: user.id });
    if (error) {
      console.error("[useDirectorAttendance.addDirector]", error.message);
      return false;
    }
    await fetchAttendance(eventId);
    return true;
  };

  const removeDirector = async (attendanceId: string) => {
    if (!eventId) return false;
    setAttendances((prev) => prev.filter((a) => a.id !== attendanceId));
    const { error } = await createClient().from("director_attendance").delete().eq("id", attendanceId);
    if (error) console.error("[useDirectorAttendance.removeDirector]", error.message);
    await fetchAttendance(eventId);
    return !error;
  };

  /** Le membre sollicité répond lui-même (mot facultatif pour l'organisateur). */
  const respondToAttendance = async (response: "approved" | "denied", comments?: string) => {
    if (!mine || !user || !eventId) return false;
    const { error } = await createClient()
      .from("director_attendance")
      .update({ status: response, comments: comments?.trim() || null, updated_by: user.id })
      .eq("id", mine.id);
    if (error) return false;
    await fetchAttendance(eventId);
    return true;
  };

  /** Ne peut pas venir : propose sa place à un autre membre du comité directeur. */
  const forwardAttendance = async (directorId: string, comments?: string) => {
    if (!mine || !user || !eventId) return false;
    const { error } = await createClient()
      .from("director_attendance")
      .update({ director_id: directorId, status: "pending", comments: comments?.trim() || null, updated_by: user.id })
      .eq("id", mine.id);
    if (error) return false;
    await fetchAttendance(eventId);
    return true;
  };

  useEffect(() => {
    void createClient()
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("role", ["comite_directeur", "comite_directeur_bad"])
      .order("first_name", { ascending: true })
      .then(({ data }) => setDirectors((data as DirectorProfile[] | null) ?? []));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement à l'ouverture de l'événement
    if (eventId) void fetchAttendance(eventId);
  }, [eventId, fetchAttendance]);

  // Live : réponse du comité directeur visible sans rechargement.
  useEffect(() => {
    if (!eventId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`director-attendance-${eventId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "director_attendance", filter: `event_id=eq.${eventId}` }, () => fetchAttendance(eventId))
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchAttendance]);

  return { attendances, mine, directors, freeDirectors, loading, addDirector, removeDirector, respondToAttendance, forwardAttendance };
}
