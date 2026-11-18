"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { CoverageRole } from "@/hooks/board/useEventCoverage";

/**
 * Renforts de captation d'un événement (photographes / vidéastes en plus du technicien principal de
 * coverage_requests) — table coverage_crew, sql/2026-11-18_event_crew.sql. La personne proposée est
 * prévenue et répond elle-même ; sa réponse prévient qui l'a proposée (trigger notify_coverage_crew).
 */
export interface CrewMember {
  id: string;
  event_id: string;
  user_id: string;
  role: CoverageRole;
  status: "pending" | "accepted" | "declined";
  notes: string | null;
  assigned_by: string | null;
}

export function useCoverageCrew(eventId?: string) {
  const { user } = useAuth();
  const [crew, setCrew] = useState<CrewMember[]>([]);

  const refetch = useCallback(async () => {
    if (!eventId) return;
    const { data, error } = await createClient()
      .from("coverage_crew")
      .select("id, event_id, user_id, role, status, notes, assigned_by")
      .eq("event_id", eventId)
      .order("created_at");
    if (error) console.error("[useCoverageCrew]", error.message);
    setCrew((data as CrewMember[] | null) ?? []);
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement à l'ouverture de l'événement
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!eventId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`coverage-crew-${eventId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "coverage_crew", filter: `event_id=eq.${eventId}` }, () => void refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, refetch]);

  const add = async (userId: string, role: CoverageRole) => {
    if (!eventId || !user) return false;
    const { error } = await createClient().from("coverage_crew").insert({ event_id: eventId, user_id: userId, role, assigned_by: user.id });
    if (error) console.error("[useCoverageCrew.add]", error.message);
    await refetch();
    return !error;
  };

  const remove = async (id: string) => {
    setCrew((prev) => prev.filter((c) => c.id !== id));
    const { error } = await createClient().from("coverage_crew").delete().eq("id", id);
    if (error) console.error("[useCoverageCrew.remove]", error.message);
    await refetch();
    return !error;
  };

  const setRole = async (id: string, role: CoverageRole) => {
    setCrew((prev) => prev.map((c) => (c.id === id ? { ...c, role } : c)));
    const { error } = await createClient().from("coverage_crew").update({ role }).eq("id", id);
    if (error) console.error("[useCoverageCrew.setRole]", error.message);
    await refetch();
    return !error;
  };

  /** La personne proposée répond (accepter / décliner, mot facultatif). */
  const respond = async (id: string, status: "accepted" | "declined", notes?: string) => {
    const { error } = await createClient().from("coverage_crew").update({ status, notes: notes?.trim() || null }).eq("id", id);
    if (error) console.error("[useCoverageCrew.respond]", error.message);
    await refetch();
    return !error;
  };

  return { crew, add, remove, setRole, respond, refetch };
}
