"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { TechnicianOption } from "@/hooks/board/useAvailableTechnicians";

export interface CoverageRequest {
  id: string;
  event_id: string | null;
  requester_id: string | null;
  status: "pending" | "approved" | "rejected" | null;
  details: string | null;
  assigned_technician_id: string | null;
  assigned_technician_name: string | null;
  assigned_technician_email: string | null;
  technician_response: string | null;
}

/**
 * Demande de couverture média + désignation d'un technicien pour un
 * événement — porté (sous-ensemble) de calendrier-lgef/src/hooks/useCoverageRequests.ts.
 * Les notifications et la file globale (vue admin) ne sont pas portées
 * dans cette passe.
 */
export function useEventCoverage(eventId?: string) {
  const { user } = useAuth();
  const [request, setRequest] = useState<CoverageRequest | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRequest = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("coverage_requests")
      .select(
        "id, event_id, requester_id, status, details, assigned_technician_id, assigned_technician_name, assigned_technician_email, technician_response"
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRequest((data as CoverageRequest | null) ?? null);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  const requestCoverage = async (details?: string) => {
    if (!eventId || !user || request) return false;
    const supabase = createClient();
    const { error } = await supabase.from("coverage_requests").insert({
      event_id: eventId,
      requester_id: user.id,
      status: "pending",
      details: details || null,
    });
    if (error) {
      console.error("[useEventCoverage.requestCoverage]", error);
      return false;
    }
    await supabase.from("events").update({ requires_coverage: true }).eq("id", eventId);
    await fetchRequest();
    return true;
  };

  const assignTechnician = async (tech: TechnicianOption) => {
    if (!eventId || !user) return false;
    const supabase = createClient();

    // Désignation directe = validée immédiatement, sans passer par le flux
    // d'acceptation du technicien (voir DirectAssignModal.tsx de calendrier-lgef).
    const payload = {
      assigned_technician_id: tech.id,
      assigned_technician_name: tech.name,
      assigned_technician_email: tech.email,
      technician_response: "accepted",
      status: "approved" as const,
    };

    const { error } = request
      ? await supabase.from("coverage_requests").update(payload).eq("id", request.id)
      : await supabase.from("coverage_requests").insert({
          event_id: eventId,
          requester_id: user.id,
          details: null,
          ...payload,
        });

    if (error) {
      console.error("[useEventCoverage.assignTechnician]", error);
      return false;
    }
    await supabase.from("events").update({ requires_coverage: true }).eq("id", eventId);
    await fetchRequest();
    return true;
  };

  return { request, loading, requestCoverage, assignTechnician, refetch: fetchRequest };
}
