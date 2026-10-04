"use server";

import { toResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyActionToken } from "@/lib/email/actionTokens";
import { CHOICES, eventWhen } from "@/lib/email/notificationEmails";

// Réponses depuis les e-mails de notification (page /action/<jeton>), sans connexion : le jeton
// signé désigne la notification et son destinataire. Mêmes effets qu'une réponse dans le board
// (useEventCoverage.respondToCoverage, useDirectorAttendance.respondToAttendance), notifications
// au créateur, aux responsables et aux admins comprises.

type Service = ReturnType<typeof createServiceClient>;
type Choice = "accept" | "refuse";

export type EmailActionView = {
  question: string;
  acceptLabel: string;
  refuseLabel: string;
  personName: string;
  event: { title: string; when: string; location: string | null };
  /** Réponse déjà donnée (par e-mail ou dans le board). */
  answered: Choice | null;
};

async function load(token: string) {
  const payload = verifyActionToken(token);
  if (!payload) throw new Error("Ce lien n'est plus valide (expiré ou incomplet). Ouvrez le board pour répondre.");
  const service = createServiceClient();
  const { data: n } = await service.from("notifications").select("id, user_id, type, event_id, data").eq("id", payload.n).single();
  const eventId = n?.event_id ?? ((n?.data as { event_id?: string } | null)?.event_id ?? null);
  if (!n || n.user_id !== payload.u || !CHOICES[n.type] || !eventId) throw new Error("Cette demande est introuvable.");
  const [{ data: event }, { data: person }] = await Promise.all([
    service.from("events").select("id, title, start_date, location, created_by").eq("id", eventId).single(),
    service.from("profiles").select("first_name, last_name, email").eq("id", payload.u).single(),
  ]);
  if (!event) throw new Error("Cet événement a été supprimé.");
  const personName = [person?.first_name, person?.last_name].filter(Boolean).join(" ").trim() || person?.email || "";
  return { service, userId: payload.u, type: n.type, event, personName };
}

async function coverageRequest(service: Service, eventId: string, userId: string) {
  const { data } = await service
    .from("coverage_requests")
    .select("id, technician_response, assigned_technician_id")
    .eq("event_id", eventId)
    .eq("assigned_technician_id", userId)
    .maybeSingle();
  return data;
}

async function directorAttendance(service: Service, eventId: string, userId: string) {
  const { data } = await service.from("director_attendance").select("id, status").eq("event_id", eventId).eq("director_id", userId).maybeSingle();
  return data;
}

/** Créateur + responsables de l'équipe (+ admins pour la couverture), comme dans le board. */
async function recipients(service: Service, eventId: string, createdBy: string | null, withAdmins: boolean) {
  const [{ data: team }, { data: admins }] = await Promise.all([
    service.from("event_team_members").select("user_id").eq("event_id", eventId).eq("role", "responsable"),
    withAdmins ? service.from("profiles").select("id").in("role", ["admin", "super_user"]) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  return [...new Set([createdBy, ...(team ?? []).map((t) => t.user_id), ...(admins ?? []).map((a) => a.id)].filter((id): id is string => !!id))];
}

async function getEmailActionImpl(token: string): Promise<EmailActionView> {
  const { service, userId, type, event, personName } = await load(token);
  const choice = CHOICES[type];
  let answered: Choice | null = null;
  if (type === "coverage_assignment") {
    const req = await coverageRequest(service, event.id, userId);
    if (!req) throw new Error("Cette mission ne vous est plus attribuée.");
    answered = req.technician_response === "accepted" ? "accept" : req.technician_response === "rejected" ? "refuse" : null;
  } else {
    const att = await directorAttendance(service, event.id, userId);
    if (!att) throw new Error("Vous n'êtes plus désigné pour cet événement.");
    answered = att.status === "approved" ? "accept" : att.status === "denied" ? "refuse" : null;
  }
  return {
    question: choice.question,
    acceptLabel: choice.accept,
    refuseLabel: choice.refuse,
    personName,
    event: { title: event.title, when: eventWhen(event), location: event.location },
    answered,
  };
}

async function performEmailActionImpl(token: string, choice: Choice, comment: string): Promise<string> {
  const { service, userId, type, event, personName } = await load(token);
  const accepted = choice === "accept";
  const note = comment.trim().slice(0, 500);

  if (type === "coverage_assignment") {
    const req = await coverageRequest(service, event.id, userId);
    if (!req) throw new Error("Cette mission ne vous est plus attribuée.");
    const { error } = await service
      .from("coverage_requests")
      .update({
        technician_response: accepted ? "accepted" : "rejected",
        technician_response_notes: note || null,
        technician_response_date: new Date().toISOString(),
        status: accepted ? "approved" : "rejected",
      })
      .eq("id", req.id);
    if (error) throw new Error(error.message);
    const to = await recipients(service, event.id, event.created_by, true);
    await service.from("notifications").insert(
      to
        .filter((id) => id !== userId)
        .map((user_id) => ({
          user_id,
          type: accepted ? ("coverage_accepted" as const) : ("coverage_rejected" as const),
          title: event.title,
          message: `${personName} ${accepted ? "a accepté" : "a refusé"} la mission de couverture média.${note ? ` « ${note} »` : ""}`,
          actor_name: personName,
          event_id: event.id,
          data: { event_id: event.id, response: accepted ? "accepted" : "rejected", via: "email" },
        }))
    );
    return accepted ? "Mission acceptée. Merci !" : "Refus enregistré. L'organisateur est prévenu.";
  }

  const att = await directorAttendance(service, event.id, userId);
  if (!att) throw new Error("Vous n'êtes plus désigné pour cet événement.");
  const { error } = await service
    .from("director_attendance")
    .update({ status: accepted ? "approved" : "denied", updated_by: userId })
    .eq("id", att.id);
  if (error) throw new Error(error.message);
  const to = await recipients(service, event.id, event.created_by, false);
  await service.from("notifications").insert(
    to
      .filter((id) => id !== userId)
      .map((user_id) => ({
        user_id,
        type: accepted ? ("director_accepted" as const) : ("director_declined" as const),
        title: event.title,
        message: `${personName} (comité directeur) ${accepted ? "a confirmé sa présence" : "ne pourra pas être présent(e)"}.${note ? ` « ${note} »` : ""}`,
        actor_name: personName,
        event_id: event.id,
        data: { event_id: event.id, response: accepted ? "approved" : "denied", via: "email" },
      }))
  );
  return accepted ? "Présence confirmée. Merci !" : "Absence enregistrée. L'organisateur est prévenu.";
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getEmailAction(token: string) {
  return toResult(() => getEmailActionImpl(token));
}

export async function performEmailAction(token: string, choice: Choice, comment: string) {
  return toResult(() => performEmailActionImpl(token, choice, comment));
}
