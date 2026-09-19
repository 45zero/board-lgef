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

/** Porté de calendrier-lgef/src/hooks/useDirectorAttendance.ts. */
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

  const saveAttendance = async (
    id: string,
    payload: { director_id: string | null; status: "pending" | "approved" | "denied"; comments?: string | null }
  ) => {
    if (!user) return false;
    const supabase = createClient();

    const { data: existing } = await supabase
      .from("director_attendance")
      .select("id")
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

  return { attendance, directors, loading, saveAttendance, deleteAttendance };
}
