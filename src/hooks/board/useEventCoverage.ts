"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { TechnicianOption } from "@/hooks/board/useAvailableTechnicians";
import { notifyUsers, getEventOwners, getAdminIds, getActorName } from "@/lib/board/notify";

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
  technician_response_notes: string | null;
  technician_response_date: string | null;
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
        "id, event_id, requester_id, status, details, assigned_technician_id, assigned_technician_name, assigned_technician_email, technician_response, technician_response_notes, technician_response_date"
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

  // Live : toute modification de la demande (par ex. le technicien qui répond
  // depuis un autre appareil) rafraîchit ce modal sans rechargement.
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  useEffect(() => {
    if (!eventId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`coverage-requests-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coverage_requests", filter: `event_id=eq.${eventId}` },
        () => fetchRequest()
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, fetchRequest]);

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

  /**
   * Assigne un technicien mais laisse la demande "en attente" — il reçoit une
   * notification et doit l'accepter/la refuser lui-même (voir
   * TechnicianAssignmentModal.tsx + le bloc notification de
   * useCoverageRequests.ts dans calendrier-lgef), à la différence de
   * assignTechnician() qui valide tout de suite.
   */
  const assignPending = async (
    tech: TechnicianOption,
    eventInfo: { title: string; start: Date }
  ) => {
    if (!eventId || !user) return false;
    const supabase = createClient();

    const payload = {
      assigned_technician_id: tech.id,
      assigned_technician_name: tech.name,
      assigned_technician_email: tech.email,
      technician_response: "pending",
      status: "pending" as const,
      coverage_symbol: null,
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
      console.error("[useEventCoverage.assignPending]", error);
      return false;
    }

    await supabase.from("events").update({ requires_coverage: true }).eq("id", eventId);

    try {
      const { data: me } = await supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", user.id)
        .maybeSingle();
      const actorName = [me?.first_name, me?.last_name].filter(Boolean).join(" ").trim() || me?.email || "";
      const eventDate = eventInfo.start.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      await supabase.rpc("create_notification", {
        p_user_id: tech.id,
        p_type: "coverage_assignment",
        p_title: `${actorName} vous a assigné à une mission`,
        p_message: `${eventInfo.title} — ${eventDate}`,
        p_actor_name: actorName,
        p_data: { event_id: eventId, technician_id: tech.id, assigned_by: user.id, assigned_by_name: actorName },
      });
    } catch (e) {
      console.warn("[useEventCoverage.assignPending] notification failed:", e);
    }

    await fetchRequest();
    return true;
  };

  /**
   * Le technicien assigné répond lui-même — accepte ou refuse, avec un
   * commentaire libre optionnel. Notifie le créateur + le(s) responsable(s)
   * de l'équipe + les admins dans les deux cas ; notifie en plus le membre
   * du comité directeur désigné, mais seulement en cas d'acceptation.
   */
  const respondToCoverage = async (response: "accepted" | "rejected", notes?: string) => {
    if (!request || !eventId || !user) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("coverage_requests")
      .update({
        technician_response: response,
        technician_response_notes: notes?.trim() || null,
        technician_response_date: new Date().toISOString(),
        status: response === "accepted" ? "approved" : "rejected",
      })
      .eq("id", request.id);
    if (error) {
      console.error("[useEventCoverage.respondToCoverage]", error);
      return false;
    }

    try {
      const [owners, adminIds, actorName, { data: ev }, { data: attendance }] = await Promise.all([
        getEventOwners(eventId),
        getAdminIds(),
        getActorName(user.id),
        supabase.from("events").select("title").eq("id", eventId).maybeSingle(),
        supabase.from("director_attendance").select("director_id").eq("event_id", eventId).maybeSingle(),
      ]);

      const verb = response === "accepted" ? "a accepté" : "a refusé";
      const notifType = response === "accepted" ? "coverage_accepted" : "coverage_rejected";
      await notifyUsers([...owners, ...adminIds], {
        type: notifType,
        title: ev?.title ?? "Événement",
        message: `${actorName} ${verb} la mission de couverture média.`,
        actorName,
        data: { event_id: eventId, response },
      });

      if (response === "accepted" && attendance?.director_id) {
        await notifyUsers([attendance.director_id], {
          type: "coverage_accepted",
          title: ev?.title ?? "Événement",
          message: `${actorName} a accepté la mission de couverture média.`,
          actorName,
          data: { event_id: eventId, response },
        });
      }
    } catch (e) {
      console.warn("[useEventCoverage.respondToCoverage] notification failed:", e);
    }

    await fetchRequest();
    return true;
  };

  return {
    request,
    loading,
    requestCoverage,
    assignTechnician,
    assignPending,
    respondToCoverage,
    refetch: fetchRequest,
  };
}
