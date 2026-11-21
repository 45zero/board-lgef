"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Attribution d'une publication (vidéo, album…) à la personne chargée de la publier
// (sql/2026-11-22_publication_assignee.sql). Par défaut, celles des événements d'Anthony Drouhin lui
// sont attribuées (board_settings.publication_self_assign_creators) ; on réattribue d'ici.

type Service = ReturnType<typeof createServiceClient>;
export type AssigneeOption = { id: string; name: string };
export type EventPublicationAssignee = { pubId: string; fileIds: string[]; assignedTo: string | null };

// Colonne et fonction ajoutées par la migration : absentes des types générés.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (service: Service) => service as any;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { userId, service: createServiceClient() };
}

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—";

async function candidates(service: Service): Promise<AssigneeOption[]> {
  const { data, error } = await raw(service).rpc("publication_assignee_candidates");
  if (error) return [];
  return ((data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map((p) => ({
    id: p.id,
    name: personName(p),
  }));
}

/** Personnes à qui l'on peut attribuer une publication (celles qui voient le centre de publication). */
export async function listPublicationAssignees() {
  return toResult(async () => {
    const { service } = await session();
    return candidates(service);
  });
}

/** Publications pas encore publiées d'un événement et leur personne attribuée (onglet Fichiers). */
export async function eventPublicationAssignees(eventId: string) {
  return toResult(async (): Promise<EventPublicationAssignee[]> => {
    const { service } = await session();
    const { data, error } = await raw(service)
      .from("media_publications")
      .select("id, event_file_id, file_ids, assigned_to")
      .eq("event_id", eventId)
      .neq("status", "published");
    if (error) return []; // migration pas encore appliquée
    return ((data ?? []) as { id: string; event_file_id: string | null; file_ids: string[] | null; assigned_to: string | null }[]).map((p) => ({
      pubId: p.id,
      fileIds: p.file_ids?.length ? p.file_ids : p.event_file_id ? [p.event_file_id] : [],
      assignedTo: p.assigned_to,
    }));
  });
}

/** Attribue (ou retire, `null`) une publication ; la personne attribuée est prévenue (cloche, push, e-mail). */
export async function assignPublication(pubId: string, assigneeId: string | null) {
  return toResult(async () => {
    const { userId, service } = await session();
    const { data: pub, error } = await raw(service)
      .from("media_publications")
      .select("id, event_id, title, status, created_by, assigned_to, events(title)")
      .eq("id", pubId)
      .single();
    if (error || !pub) throw new Error("Publication introuvable.");
    const p = pub as { id: string; event_id: string | null; title: string | null; status: string; created_by: string | null; assigned_to: string | null; events: { title: string } | null };

    // Mêmes droits que la modification d'une publication (policy mp_update).
    const [{ data: me }, { data: canSee }] = await Promise.all([
      service.from("profiles").select("role, first_name, last_name, email").eq("id", userId).single(),
      service.rpc("can_see_module", { uid: userId, p_module: "audiovisuel" }),
    ]);
    const admin = me?.role === "admin" || me?.role === "super_user";
    if (!admin && !canSee && p.created_by !== userId) throw new Error("Vous ne pouvez pas attribuer cette publication.");
    if (p.status === "published") throw new Error("Cette publication est déjà publiée.");

    if (assigneeId && !(await candidates(service)).some((c) => c.id === assigneeId)) {
      throw new Error("Cette personne n'a pas accès au centre de publication.");
    }
    if (assigneeId === p.assigned_to) return;

    const { error: upErr } = await raw(service).from("media_publications").update({ assigned_to: assigneeId }).eq("id", pubId);
    if (upErr) throw new Error("Attribution impossible pour le moment.");

    if (assigneeId && assigneeId !== userId) {
      const actor = me ? personName(me) : "Quelqu'un";
      const label = p.events?.title ?? p.title ?? "Publication directe";
      const { error: nErr } = await service.rpc("create_notification", {
        p_user_id: assigneeId,
        p_type: "publication_to_publish",
        p_title: "Média à publier",
        p_message: `${actor} vous a attribué une publication : ${label}.`,
        p_actor_name: actor,
        p_data: { publication_id: pubId, event_id: p.event_id },
      });
      if (nErr) console.error("[assignPublication.notify]", nErr.message);
    }
  });
}
