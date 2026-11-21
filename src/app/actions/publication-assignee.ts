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

/** Peut publier = voit le centre de publication (Paramètres → Publication), ou administrateur / super user. */
async function canPublish(service: Service, userId: string) {
  const [{ data: me }, { data: canSee }] = await Promise.all([
    service.from("profiles").select("role").eq("id", userId).single(),
    service.rpc("can_see_module", { uid: userId, p_module: "audiovisuel" }),
  ]);
  return me?.role === "admin" || me?.role === "super_user" || !!canSee;
}

/**
 * Personnes à qui l'on peut attribuer une publication (celles qui voient le centre de publication).
 * Liste vide pour qui ne peut pas publier : le menu « À publier par » ne s'affiche alors pas.
 */
export async function listPublicationAssignees() {
  return toResult(async () => {
    const { userId, service } = await session();
    if (!(await canPublish(service, userId))) return [];
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
      .select("id, event_id, title, kind, status, created_by, assigned_to, events(title)")
      .eq("id", pubId)
      .single();
    if (error || !pub) throw new Error("Publication introuvable.");
    const p = pub as {
      id: string;
      event_id: string | null;
      title: string | null;
      kind: string | null;
      status: string;
      created_by: string | null;
      assigned_to: string | null;
      events: { title: string } | null;
    };

    // Mêmes droits que la modification d'une publication (policy mp_update).
    const [{ data: me }, { data: canSee }] = await Promise.all([
      service.from("profiles").select("role, first_name, last_name, email").eq("id", userId).single(),
      service.rpc("can_see_module", { uid: userId, p_module: "audiovisuel" }),
    ]);
    const admin = me?.role === "admin" || me?.role === "super_user";
    if (!admin && !canSee) throw new Error("Seules les personnes qui peuvent publier attribuent les publications.");
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
      const k = KIND[p.kind ?? ""] ?? KIND.other;
      await notify(service, assigneeId, {
        title: k.title,
        message: `Vous avez ${k.what} à publier : ${label} (attribué par ${actor}).`,
        actor,
        data: { publication_id: pubId, event_id: p.event_id },
      });
    }
  });
}

const KIND: Record<string, { title: string; what: string }> = {
  video: { title: "Vidéo à publier", what: "une vidéo" },
  photo: { title: "Photo à publier", what: "une photo" },
  gallery: { title: "Photos à publier", what: "des photos" },
  other: { title: "Média à publier", what: "un média" },
};

/** Notification « publication_to_publish » (cloche, push, e-mail) ; un échec ne bloque pas l'action. */
async function notify(service: Service, userId: string, n: { title: string; message: string; actor: string; data: Record<string, unknown> }) {
  const { error } = await service.rpc("create_notification", {
    p_user_id: userId,
    p_type: "publication_to_publish",
    p_title: n.title,
    p_message: n.message,
    p_actor_name: n.actor,
    p_data: n.data as never,
  });
  if (error) console.error("[publication-assignee.notify]", error.message);
}

/* ---------- Personne chargée de publier, sur l'événement ---------- */

/** Personne chargée de publier les médias de l'événement (`null` : personne en particulier). */
export async function getEventPublisher(eventId: string) {
  return toResult(async (): Promise<string | null> => {
    const { service } = await session();
    const { data, error } = await raw(service).from("events").select("publisher_id").eq("id", eventId).single();
    if (error) return null; // migration pas encore appliquée
    return (data as { publisher_id: string | null }).publisher_id;
  });
}

/**
 * Choisit la personne chargée de publier les médias de l'événement, même sans vidéo ni captation
 * acceptée. Les publications pas encore publiées qui n'avaient personne (ou l'ancienne personne)
 * passent à la nouvelle ; les vidéos déposées ensuite lui seront attribuées. Elle est prévenue.
 */
export async function setEventPublisher(eventId: string, publisherId: string | null) {
  return toResult(async () => {
    const { userId, service } = await session();
    const { data: ev, error } = await raw(service).from("events").select("id, title, created_by, publisher_id").eq("id", eventId).single();
    if (error || !ev) throw new Error("Événement introuvable.");
    const e = ev as { id: string; title: string; created_by: string | null; publisher_id: string | null };

    const [{ data: me }, { data: canSee }] = await Promise.all([
      service.from("profiles").select("role, first_name, last_name, email").eq("id", userId).single(),
      service.rpc("can_see_module", { uid: userId, p_module: "audiovisuel" }),
    ]);
    const admin = me?.role === "admin" || me?.role === "super_user";
    if (!admin && !canSee) throw new Error("Seules les personnes qui peuvent publier choisissent qui publie.");
    if (publisherId && !(await candidates(service)).some((c) => c.id === publisherId)) {
      throw new Error("Cette personne n'a pas accès au centre de publication.");
    }
    if (publisherId === e.publisher_id) return;

    const { error: upErr } = await raw(service).from("events").update({ publisher_id: publisherId }).eq("id", eventId);
    if (upErr) throw new Error("Enregistrement impossible pour le moment.");

    // Publications en attente : celles sans personne ou suivant l'ancien choix de l'événement.
    let q = raw(service).from("media_publications").update({ assigned_to: publisherId }).eq("event_id", eventId).neq("status", "published");
    q = e.publisher_id ? q.or(`assigned_to.is.null,assigned_to.eq.${e.publisher_id}`) : q.is("assigned_to", null);
    const { data: moved } = await q.select("id, kind");

    if (publisherId && publisherId !== userId) {
      const actor = me ? personName(me) : "Quelqu'un";
      const pending = (moved ?? []) as { id: string; kind: string | null }[];
      const videos = pending.filter((p) => p.kind === "video").length;
      const message = videos
        ? `Vous avez ${videos > 1 ? `${videos} vidéos` : "une vidéo"} à publier : ${e.title} (attribué par ${actor}).`
        : pending.length
          ? `Vous avez des médias à publier : ${e.title} (attribué par ${actor}).`
          : `Vous êtes chargé(e) de publier les vidéos de « ${e.title} » (attribué par ${actor}). Vous serez prévenu(e) dès qu'une vidéo sera déposée.`;
      await notify(service, publisherId, {
        title: videos ? "Vidéo à publier" : pending.length ? "Médias à publier" : "Publication attribuée",
        message,
        actor,
        data: { event_id: eventId },
      });
    }
  });
}
