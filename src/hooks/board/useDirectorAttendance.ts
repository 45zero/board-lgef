"use client";

import { useState, useEffect } from "react";
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
 * Porté de calendrier-lgef/src/hooks/useDirectorAttendance.ts. Les notifications (membre sollicité,
 * réponse au créateur, aux responsables et au N+1, transfert à un autre membre) partent du trigger
 * notify_director_attendance (sql/2026-10-04_circuit_couverture_comite.sql).
 */
export function useDirectorAttendance(eventId?: string) {
  const [attendance, setAttendance] = useState<DirectorAttendance | null>(null);
  const [directors, setDirectors] = useState<DirectorProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const fetchAttendance = async (id: string) => {
    if (!id) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("director_attendance").select("*").eq("event_id", id).maybeSingle();
    setAttendance((data as DirectorAttendance | null) ?? null);
    setLoading(false);
  };

  const fetchDirectors = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("role", ["comite_directeur", "comite_directeur_bad"])
      .order("first_name", { ascending: true });
    setDirectors((data as DirectorProfile[] | null) ?? []);
  };

  /** Désigne un membre du comité directeur — laissé "pending" pour qu'il confirme lui-même, et notifié. */
  const saveAttendance = async (
    id: string,
    payload: { director_id: string | null; status: "pending" | "approved" | "denied"; comments?: string | null }
  ) => {
    if (!user) return false;
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("director_attendance")
      .select("id, director_id")
      .eq("event_id", id)
      .maybeSingle();

    const { data, error } = existing
      ? await supabase
          .from("director_attendance")
          .update({ ...payload, updated_by: user.id })
          .eq("id", existing.id)
          .select()
          .single()
      : await supabase
          .from("director_attendance")
          .insert({ event_id: id, ...payload, created_by: user.id, updated_by: user.id })
          .select()
          .single();

    if (error) return false;
    setAttendance(data as DirectorAttendance);

    return true;
  };

  /** Le membre du comité directeur sollicité répond lui-même (mot facultatif pour l'organisateur). */
  const respondToAttendance = async (response: "approved" | "denied", comments?: string) => {
    if (!attendance || !user || !eventId) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("director_attendance")
      .update({ status: response, comments: comments?.trim() || null, updated_by: user.id })
      .eq("id", attendance.id);
    if (error) return false;
    await fetchAttendance(eventId);
    return true;
  };

  /** Ne peut pas venir : propose la présence à un autre membre du comité directeur. */
  const forwardAttendance = async (directorId: string, comments?: string) => {
    if (!attendance || !user || !eventId) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("director_attendance")
      .update({ director_id: directorId, status: "pending", comments: comments?.trim() || null, updated_by: user.id })
      .eq("id", attendance.id);
    if (error) return false;
    await fetchAttendance(eventId);
    return true;
  };

  const deleteAttendance = async () => {
    if (!eventId) return false;
    const supabase = createClient();
    await supabase.from("director_attendance").delete().eq("event_id", eventId);
    setAttendance(null);
    return true;
  };

  useEffect(() => {
    fetchDirectors();
  }, []);

  useEffect(() => {
    if (eventId) fetchAttendance(eventId);
  }, [eventId]);

  // Live : réponse du comité directeur visible sans rechargement.
  useEffect(() => {
    if (!eventId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`director-attendance-${eventId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "director_attendance", filter: `event_id=eq.${eventId}` },
        () => fetchAttendance(eventId)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { attendance, directors, loading, saveAttendance, respondToAttendance, forwardAttendance, deleteAttendance };
}
