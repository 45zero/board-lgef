"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TeamMember {
  id: string;
  event_id: string;
  user_id: string;
  role: "responsable" | "membre";
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

/** Porté de calendrier-lgef/src/hooks/useEventTeam.ts. */
export function useEventTeam(eventId: string, createdBy: string | null) {
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);

  const fetchTeam = async () => {
    const supabase = createClient();
    const { data } = await supabase.from("event_team_members").select("*, profiles(*)").eq("event_id", eventId);
    setTeam((data as TeamMember[] | null) ?? []);
  };

  useEffect(() => {
    if (eventId) fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const isCreator = user?.id === createdBy;
  const isResponsable = team.some((m) => m.user_id === user?.id && m.role === "responsable");
  const canManageMembers = isCreator || isResponsable;

  const addMember = async (userId: string, role: "responsable" | "membre") => {
    if (!canManageMembers) return;
    const supabase = createClient();

    if (role === "responsable") {
      await supabase.from("event_team_members").delete().eq("event_id", eventId).eq("role", "responsable");
    }

    await supabase.from("event_team_members").insert({ event_id: eventId, user_id: userId, role });
    fetchTeam();
  };

  const removeMember = async (member: TeamMember) => {
    const canDelete = isCreator || (isResponsable && member.role === "membre");
    if (!canDelete) return;

    const supabase = createClient();
    await supabase.from("event_team_members").delete().eq("id", member.id);
    fetchTeam();
  };

  /** Désigne userId comme unique responsable — rétrograde l'ancien sans dupliquer sa ligne. */
  const setResponsable = async (userId: string) => {
    if (!canManageMembers) return;
    const supabase = createClient();
    await supabase
      .from("event_team_members")
      .update({ role: "membre" })
      .eq("event_id", eventId)
      .eq("role", "responsable");
    await supabase
      .from("event_team_members")
      .update({ role: "responsable" })
      .eq("event_id", eventId)
      .eq("user_id", userId);
    fetchTeam();
  };

  return { team, addMember, removeMember, setResponsable, isCreator, isResponsable, canManageMembers };
}
