"use server";

import { toResult } from "@/lib/board/actionResult";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { verifyActionToken } from "@/lib/email/actionTokens";
import { CHOICES, eventWhen } from "@/lib/email/notificationEmails";

// Réponses depuis les e-mails de notification (page /action/<jeton>), sans connexion : le jeton
// signé désigne la notification et son destinataire. Mêmes effets qu'une réponse dans le board
// (useEventCoverage.respondToCoverage, useDirectorAttendance.respondToAttendance) ; les notifications
// (N+1, réceptionnaires, créateur, responsables) partent des triggers de
// sql/2026-10-04_circuit_couverture_comite.sql. Un membre du comité directeur qui ne peut pas venir
// peut proposer un autre membre.

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
  /** Comité directeur : autres membres à qui proposer la présence en cas de refus. */
  peers: { id: string; name: string }[];
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
  let peers: EmailActionView["peers"] = [];
  if (type !== "coverage_assignment") {
    const { data } = await service
      .from("profiles")
      .select("id, first_name, last_name, email")
      .in("role", ["comite_directeur", "comite_directeur_bad"])
      .neq("id", userId)
      .order("last_name");
    peers = (data ?? []).map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "—" }));
  }
  return {
    question: choice.question,
    acceptLabel: choice.accept,
    refuseLabel: choice.refuse,
    personName,
    event: { title: event.title, when: eventWhen(event), location: event.location },
    answered,
    peers,
  };
}

async function performEmailActionImpl(token: string, choice: Choice, comment: string, forwardTo: string | null): Promise<string> {
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
        status: accepted ? "approved" : "pending",
      })
      .eq("id", req.id);
    if (error) throw new Error(error.message);
    return accepted ? "Mission acceptée. Merci !" : "Refus enregistré. La demande est remise en attente et les personnes concernées sont prévenues.";
  }

  const att = await directorAttendance(service, event.id, userId);
  if (!att) throw new Error("Vous n'êtes plus désigné pour cet événement.");
  if (!accepted && forwardTo) {
    const { data: peer } = await service.from("profiles").select("id, role").eq("id", forwardTo).single();
    if (!peer || !["comite_directeur", "comite_directeur_bad"].includes(peer.role ?? "")) throw new Error("Ce membre du comité directeur est introuvable.");
    // Refus d'abord (créateur et responsables prévenus), puis la présence est proposée au membre choisi.
    await service.from("director_attendance").update({ status: "denied", comments: note || null, updated_by: userId }).eq("id", att.id);
    const { error } = await service
      .from("director_attendance")
      .update({ director_id: forwardTo, status: "pending", comments: `Proposé par ${personName}${note ? ` : « ${note} »` : ""}`, updated_by: userId })
      .eq("id", att.id);
    if (error) throw new Error(error.message);
    return "C'est noté : la présence est proposée au membre choisi, l'organisateur est prévenu.";
  }
  const { error } = await service
    .from("director_attendance")
    .update({ status: accepted ? "approved" : "denied", comments: note || null, updated_by: userId })
    .eq("id", att.id);
  if (error) throw new Error(error.message);
  return accepted ? "Présence confirmée. Merci !" : "Absence enregistrée. L'organisateur est prévenu.";
}

/* ---------- Actions exportées : erreurs renvoyées, pas levées (voir actionResult.ts) ---------- */

export async function getEmailAction(token: string) {
  return toResult(() => getEmailActionImpl(token));
}

export async function performEmailAction(token: string, choice: Choice, comment: string, forwardTo: string | null = null) {
  return toResult(() => performEmailActionImpl(token, choice, comment, forwardTo));
}
