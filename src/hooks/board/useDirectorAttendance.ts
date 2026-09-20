"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { notifyUsers, getEventOwners, getActorName } from "@/lib/board/notify";

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

/** Porté de calendrier-lgef/src/hooks/useDirectorAttendance.ts + notifications. */
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
      .eq("role", "comite_directeur")
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

    const isNewAssignment = !!payload.director_id && payload.director_id !== existing?.director_id;

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

    if (isNewAssignment && payload.director_id) {
      try {
        const [actorName, { data: ev }] = await Promise.all([
          getActorName(user.id),
          supabase.from("events").select("title").eq("id", id).maybeSingle(),
        ]);
        await notifyUsers([payload.director_id], {
          type: "director_invitation",
          title: ev?.title ?? "Événement",
          message: `${actorName} vous a désigné(e) comme membre du comité directeur pour cet événement.`,
          actorName,
          data: { event_id: id },
        });
      } catch (e) {
        console.warn("[useDirectorAttendance.saveAttendance] notification failed:", e);
      }
    }

    return true;
  };

  /** Le membre du comité directeur désigné répond lui-même — notifie créateur + responsable(s). */
  const respondToAttendance = async (response: "approved" | "denied") => {
    if (!attendance || !user || !eventId) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("director_attendance")
      .update({ status: response, updated_by: user.id })
      .eq("id", attendance.id);
    if (error) return false;

    try {
      const [owners, actorName, { data: ev }] = await Promise.all([
        getEventOwners(eventId),
        getActorName(user.id),
        supabase.from("events").select("title").eq("id", eventId).maybeSingle(),
      ]);
      const verb = response === "approved" ? "a confirmé sa présence" : "ne pourra pas être présent(e)";
      await notifyUsers(owners, {
        type: response === "approved" ? "director_accepted" : "director_declined",
        title: ev?.title ?? "Événement",
        message: `${actorName} (comité directeur) ${verb}.`,
        actorName,
        data: { event_id: eventId, response },
      });
    } catch (e) {
      console.warn("[useDirectorAttendance.respondToAttendance] notification failed:", e);
    }

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
      .channel(`director-attendance-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "director_attendance", filter: `event_id=eq.${eventId}` },
        () => fetchAttendance(eventId)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return { attendance, directors, loading, saveAttendance, respondToAttendance, deleteAttendance };
}
