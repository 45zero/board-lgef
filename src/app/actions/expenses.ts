"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { DbEventType } from "@/lib/board/calendar";
import { getSolicitations, type SolicitationRole } from "@/lib/board/solicitation";

// Gestion des frais du board. Données partagées avec l'appli calendrier :
// - event_expenses : lignes de frais d'une personne sur un événement (écrites par le client, RLS « own ») ;
// - expense_submissions : la déclaration (une par personne et par événement), statut
//   pending → approved / rejected, ou no_expense (« pas de frais »).
// Les déclarations ne sont modifiables en base que par les admins (RLS) : ces actions passent par
// le client service role APRÈS avoir vérifié elles-mêmes le droit (la personne, son N+1, un admin).

export type ExpenseStatus = "a_declarer" | "pending" | "approved" | "rejected" | "no_expense";
export type { SolicitationRole } from "@/lib/board/solicitation";

export type MyExpenseItem = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  eventType: DbEventType | null;
  roles: SolicitationRole[];
  total: number;
  lineCount: number;
  status: ExpenseStatus;
  submissionId: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  reviewerComment: string | null;
};

export type ExpenseLine = {
  id: string;
  toll_fees: number | null;
  meal_fees: number | null;
  other_fees: number | null;
  other_fees_description: string | null;
  transport_fees: number | null;
  parking_fees: number | null;
  fuel_fees: number | null;
  hotel_fees: number | null;
  car_rental_fees: number | null;
  distance_km: number | null;
  description: string | null;
  total_amount: number | null;
  file_url: string | null;
};

export type SubmissionToReview = {
  submissionId: string;
  status: ExpenseStatus;
  total: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerComment: string | null;
  person: { id: string; name: string; email: string | null };
  event: { id: string; title: string; start: string; eventType: DbEventType | null };
  lines: ExpenseLine[];
  attachments: { url: string; name: string }[];
};

type Person = { id: string; first_name: string | null; last_name: string | null; email: string | null; role: string | null };

const personName = (p: Pick<Person, "first_name" | "last_name" | "email"> | null | undefined) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—" : "—";

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const [{ data: profile }, { data: settings }] = await Promise.all([
    service.from("profiles").select("id, role").eq("id", userId).single(),
    service.from("board_settings").select("expense_manager_ids").eq("id", true).single(),
  ]);
  const isAdmin = profile?.role === "admin" || profile?.role === "super_user";
  // Régler les N+1 : administrateurs + personnes désignées par un administrateur.
  const canManageValidators = isAdmin || (settings?.expense_manager_ids ?? []).includes(userId);
  return { userId, isAdmin, canManageValidators, service };
}

function toStatus(s: string | null | undefined): ExpenseStatus {
  if (s === "pending" || s === "revision_requested") return "pending";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "no_expense") return "no_expense";
  return "a_declarer";
}

/**
 * Mes frais : les événements (commencés, 12 derniers mois) où je suis sollicité — membre ou
 * responsable d'équipe, assigné, comité directeur à la présence confirmée, technicien ayant accepté
 * la captation — plus ceux où j'ai déjà une déclaration, avec total des lignes et statut.
 */
export async function getMyExpenses(): Promise<MyExpenseItem[]> {
  const { userId, service } = await currentUser();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();

  // Frais : seulement les sollicitations effectives (présence confirmée, captation acceptée).
  const [roles, submissions] = await Promise.all([
    getSolicitations(service, userId),
    service
      .from("expense_submissions")
      .select("id, event_id, status, submitted_at, reviewed_at, reviewed_by, reviewer_comments, reviewer_comment")
      .eq("user_id", userId),
  ]);

  const subByEvent = new Map((submissions.data ?? []).filter((s) => s.event_id).map((s) => [s.event_id as string, s]));
  const eventIds = [...new Set([...roles.keys(), ...subByEvent.keys()])];
  if (eventIds.length === 0) return [];

  const [{ data: events }, { data: lines }] = await Promise.all([
    service
      .from("events")
      .select("id, title, start_date, end_date, event_type")
      .in("id", eventIds)
      .lte("start_date", new Date().toISOString())
      .gte("start_date", since)
      .order("start_date", { ascending: false }),
    service.from("event_expenses").select("event_id, total_amount").eq("user_id", userId).in("event_id", eventIds),
  ]);

  const totals = new Map<string, { total: number; count: number }>();
  for (const l of lines ?? []) {
    if (!l.event_id) continue;
    const cur = totals.get(l.event_id) ?? { total: 0, count: 0 };
    totals.set(l.event_id, { total: cur.total + Number(l.total_amount ?? 0), count: cur.count + 1 });
  }

  const reviewerIds = [...new Set((submissions.data ?? []).map((s) => s.reviewed_by).filter((id): id is string => !!id))];
  const { data: reviewers } = reviewerIds.length
    ? await service.from("profiles").select("id, first_name, last_name, email").in("id", reviewerIds)
    : { data: [] as Person[] };
  const reviewerById = new Map((reviewers ?? []).map((r) => [r.id, r]));

  return (events ?? []).map((e) => {
    const sub = subByEvent.get(e.id);
    const t = totals.get(e.id) ?? { total: 0, count: 0 };
    return {
      eventId: e.id,
      title: e.title,
      start: e.start_date,
      end: e.end_date,
      eventType: e.event_type as DbEventType | null,
      roles: [...(roles.get(e.id) ?? [])],
      total: t.total,
      lineCount: t.count,
      status: toStatus(sub?.status),
      submissionId: sub?.id ?? null,
      submittedAt: sub?.submitted_at ?? null,
      reviewedAt: sub?.reviewed_at ?? null,
      reviewerName: sub?.reviewed_by ? personName(reviewerById.get(sub.reviewed_by)) : null,
      reviewerComment: sub?.reviewer_comments ?? sub?.reviewer_comment ?? null,
    };
  });
}

async function notify(service: ReturnType<typeof createServiceClient>, userIds: string[], title: string, message: string, data: Record<string, unknown>) {
  for (const userId of userIds) {
    const { data: notif } = await service
      .from("notifications")
      .insert({ user_id: userId, type: "expense_to_validate", title, message, data: data as never })
      .select("id")
      .single();
    await service
      .from("push_outbox")
      .insert({ user_id: userId, title, body: message, data, type: "expense_to_validate", notification_id: notif?.id ?? null } as never);
  }
}

/**
 * Déclare mes frais d'un événement (ou « pas de frais ») : la déclaration passe en attente de
 * validation et mon N+1 est prévenu. Possible tant qu'elle n'est pas validée (y compris après un refus).
 */
export async function declareExpenses(eventId: string, noExpense = false): Promise<{ error: string | null }> {
  try {
    const { userId, service } = await currentUser();
    const { data: lines } = await service.from("event_expenses").select("id, total_amount").eq("event_id", eventId).eq("user_id", userId);
    if (!noExpense && (lines ?? []).length === 0) throw new Error("Ajoutez au moins une ligne de frais avant de déclarer.");

    const { data: existing } = await service
      .from("expense_submissions")
      .select("id, status")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.status === "approved") throw new Error("Ces frais sont déjà validés.");

    const payload = {
      user_id: userId,
      event_id: eventId,
      expense_ids: (lines ?? []).map((l) => l.id),
      total_amount: noExpense ? 0 : (lines ?? []).reduce((n, l) => n + Number(l.total_amount ?? 0), 0),
      status: noExpense ? "no_expense" : "pending",
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      reviewer_comments: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await service.from("expense_submissions").update(payload).eq("id", existing.id)
      : await service.from("expense_submissions").insert(payload);
    if (error) throw new Error(error.message);

    if (!noExpense) {
      const [{ data: me }, { data: event }] = await Promise.all([
        service.from("profiles").select("first_name, last_name, email, expense_validator_id").eq("id", userId).single(),
        service.from("events").select("title").eq("id", eventId).single(),
      ]);
      if (me?.expense_validator_id) {
        await notify(
          service,
          [me.expense_validator_id],
          "Frais à valider",
          `${personName(me)} a déclaré ${payload.total_amount.toFixed(2)} € pour « ${event?.title ?? "un événement"} ».`,
          { kind: "expense_to_validate", event_id: eventId }
        );
      }
    }
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** Suis-je N+1 d'au moins une personne (ou admin) ? — affiche l'onglet « À valider ». */
export async function getMyValidatorScope(): Promise<{ isValidator: boolean; isAdmin: boolean; canManageValidators: boolean; pending: number }> {
  const { userId, isAdmin, canManageValidators, service } = await currentUser();
  const { data: reports } = await service.from("profiles").select("id").eq("expense_validator_id", userId);
  const ids = (reports ?? []).map((r) => r.id);
  let pending = 0;
  if (ids.length > 0) {
    const { count } = await service
      .from("expense_submissions")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "revision_requested"])
      .in("user_id", ids);
    pending = count ?? 0;
  }
  return { isValidator: ids.length > 0, isAdmin, canManageValidators, pending };
}

/**
 * Déclarations à valider : celles des personnes dont je suis le N+1 ; un admin peut voir toutes les
 * déclarations (`scope: "all"`). Lignes de frais et justificatifs inclus pour la fiche de validation.
 */
export async function getSubmissionsToReview(
  status: "pending" | "approved" | "rejected",
  scope: "mine" | "all" = "mine"
): Promise<SubmissionToReview[]> {
  const { userId, isAdmin, service } = await currentUser();
  let userIds: string[] | null = null;
  if (scope === "mine" || !isAdmin) {
    const { data: reports } = await service.from("profiles").select("id").eq("expense_validator_id", userId);
    userIds = (reports ?? []).map((r) => r.id);
    if (userIds.length === 0) return [];
  }

  let q = service
    .from("expense_submissions")
    .select("id, user_id, event_id, expense_ids, total_amount, status, submitted_at, reviewed_at, reviewer_comments, reviewer_comment")
    .in("status", status === "pending" ? ["pending", "revision_requested"] : [status])
    .order("submitted_at", { ascending: status === "pending", nullsFirst: false })
    .limit(200);
  if (userIds) q = q.in("user_id", userIds);
  const { data: subs } = await q;
  if (!subs?.length) return [];

  const personIds = [...new Set(subs.map((s) => s.user_id))];
  const eventIds = [...new Set(subs.map((s) => s.event_id).filter((id): id is string => !!id))];
  const [{ data: people }, { data: events }, { data: lines }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email").in("id", personIds),
    service.from("events").select("id, title, start_date, event_type").in("id", eventIds),
    service.from("event_expenses").select("*").in("event_id", eventIds).in("user_id", personIds),
  ]);
  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: atts } = lineIds.length
    ? await service.from("event_expense_attachments").select("expense_id, file_url, file_type").in("expense_id", lineIds)
    : { data: [] as { expense_id: string; file_url: string; file_type: string | null }[] };

  const peopleById = new Map((people ?? []).map((p) => [p.id, p]));
  const eventsById = new Map((events ?? []).map((e) => [e.id, e]));

  return subs
    .filter((s) => s.event_id && eventsById.has(s.event_id))
    .map((s) => {
      const event = eventsById.get(s.event_id!)!;
      const person = peopleById.get(s.user_id);
      const myLines = (lines ?? []).filter((l) => l.event_id === s.event_id && l.user_id === s.user_id) as unknown as (ExpenseLine & {
        event_id: string;
        user_id: string;
      })[];
      const attachments = [
        ...myLines.filter((l) => l.file_url).map((l) => ({ url: l.file_url!, name: "Justificatif" })),
        ...(atts ?? [])
          .filter((a) => myLines.some((l) => l.id === a.expense_id))
          .map((a, i) => ({ url: a.file_url, name: `Pièce jointe ${i + 1}` })),
      ];
      return {
        submissionId: s.id,
        status: toStatus(s.status),
        total: Number(s.total_amount ?? myLines.reduce((n, l) => n + Number(l.total_amount ?? 0), 0)),
        submittedAt: s.submitted_at,
        reviewedAt: s.reviewed_at,
        reviewerComment: s.reviewer_comments ?? s.reviewer_comment ?? null,
        person: { id: s.user_id, name: personName(person), email: person?.email ?? null },
        event: { id: event.id, title: event.title, start: event.start_date, eventType: event.event_type as DbEventType | null },
        lines: myLines,
        attachments,
      };
    });
}

/** Valide ou refuse une déclaration — réservé au N+1 du déclarant et aux admins ; le déclarant est prévenu. */
export async function reviewSubmission(
  submissionId: string,
  decision: "approved" | "rejected",
  comment: string
): Promise<{ error: string | null }> {
  try {
    const { userId, isAdmin, service } = await currentUser();
    const { data: sub } = await service.from("expense_submissions").select("id, user_id, event_id, total_amount").eq("id", submissionId).single();
    if (!sub) throw new Error("Déclaration introuvable.");
    if (!isAdmin) {
      const { data: owner } = await service.from("profiles").select("expense_validator_id").eq("id", sub.user_id).single();
      if (owner?.expense_validator_id !== userId) throw new Error("Vous n'êtes pas le responsable de cette personne.");
    }
    if (decision === "rejected" && !comment.trim()) throw new Error("Indiquez le motif du refus.");

    const { error } = await service
      .from("expense_submissions")
      .update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
        reviewer_comments: comment.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    if (error) throw new Error(error.message);

    const { data: event } = await service.from("events").select("title").eq("id", sub.event_id!).single();
    await notify(
      service,
      [sub.user_id],
      decision === "approved" ? "Frais validés" : "Frais refusés",
      decision === "approved"
        ? `Vos frais (${Number(sub.total_amount ?? 0).toFixed(2)} €) pour « ${event?.title ?? "un événement"} » ont été validés.`
        : `Vos frais pour « ${event?.title ?? "un événement"} » ont été refusés : ${comment.trim()}`,
      { kind: "expense_reviewed", event_id: sub.event_id, decision }
    );
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

export type ValidatorAssignment = { id: string; name: string; email: string | null; role: string | null; validatorId: string | null };

/** Administration : tous les utilisateurs et leur responsable N+1. */
export async function getValidatorAssignments(): Promise<ValidatorAssignment[]> {
  const { canManageValidators, service } = await currentUser();
  if (!canManageValidators) throw new Error("Vous n'avez pas accès au réglage des responsables.");
  const { data } = await service.from("profiles").select("id, first_name, last_name, email, role, expense_validator_id").order("last_name");
  return (data ?? []).map((p) => ({ id: p.id, name: personName(p), email: p.email, role: p.role, validatorId: p.expense_validator_id }));
}

export async function setExpenseValidator(personId: string, validatorId: string | null): Promise<{ error: string | null }> {
  try {
    const { canManageValidators, service } = await currentUser();
    if (!canManageValidators) throw new Error("Vous n'avez pas accès au réglage des responsables.");
    if (validatorId === personId) throw new Error("Une personne ne peut pas valider ses propres frais.");
    const { error } = await service.from("profiles").update({ expense_validator_id: validatorId }).eq("id", personId);
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** Statut de ma déclaration pour un événement (onglet Frais de la fiche et modal « Mes frais »). */
export async function getMyExpenseStatus(eventId: string): Promise<{
  status: ExpenseStatus;
  reviewerName: string | null;
  reviewerComment: string | null;
  reviewedAt: string | null;
}> {
  const { userId, service } = await currentUser();
  const { data: sub } = await service
    .from("expense_submissions")
    .select("status, reviewed_by, reviewed_at, reviewer_comments, reviewer_comment")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  let reviewerName: string | null = null;
  if (sub?.reviewed_by) {
    const { data: r } = await service.from("profiles").select("first_name, last_name, email").eq("id", sub.reviewed_by).single();
    reviewerName = personName(r);
  }
  return {
    status: toStatus(sub?.status),
    reviewerName,
    reviewerComment: sub?.reviewer_comments ?? sub?.reviewer_comment ?? null,
    reviewedAt: sub?.reviewed_at ?? null,
  };
}

/** Personnes autorisées (en plus des administrateurs) à régler les N+1. */
export async function getExpenseManagers(): Promise<string[]> {
  const { service } = await currentUser();
  const { data } = await service.from("board_settings").select("expense_manager_ids").eq("id", true).single();
  return data?.expense_manager_ids ?? [];
}

export async function setExpenseManagers(ids: string[]): Promise<{ error: string | null }> {
  try {
    const { isAdmin, service } = await currentUser();
    if (!isAdmin) throw new Error("Réservé aux administrateurs.");
    const { error } = await service.from("board_settings").update({ expense_manager_ids: ids }).eq("id", true);
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}
