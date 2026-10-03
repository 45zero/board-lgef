"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { archiveReceipts, type ReceiptToArchive } from "@/lib/board/expenseArchive";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import type { DbEventType } from "@/lib/board/calendar";
import { type SolicitationRole } from "@/lib/board/solicitation";
import { computeMyExpenses, lineMonth, personName, toStatus } from "@/lib/board/expensesCore";
import {
  CATEGORY_META,
  EXPENSE_CATEGORIES,
  lineParts,
  monthLabel,
  type ExpenseAmountColumn,
  type ExpenseCategory,
  type ExpenseTarget,
} from "@/lib/board/expenseCategories";

// Gestion des frais du board. Données partagées avec l'appli calendrier :
// - event_expenses : lignes de frais d'une personne, sur un événement ou hors événement (event_id nul) ;
// - event_expense_attachments : justificatifs d'une ligne (en plus de event_expenses.file_url) ;
// - expense_submissions : la déclaration (une par personne et par événement, ou par mois pour les
//   frais hors événement — period_month), statut pending → approved / rejected, ou no_expense.
// Les déclarations ne sont modifiables en base que par les admins (RLS) : ces actions passent par
// le client service role APRÈS avoir vérifié elles-mêmes le droit (la personne, son N+1, un admin).

export type ExpenseStatus = "a_declarer" | "pending" | "approved" | "rejected" | "no_expense";
export type { SolicitationRole } from "@/lib/board/solicitation";

export type MyExpenseItem = {
  /** Identifiant stable de la fiche (événement ou mois hors événement). */
  key: string;
  /** Nul pour les frais hors événement. */
  eventId: string | null;
  /** 'YYYY-MM' pour les frais hors événement. */
  month: string | null;
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
  /** Événement à venir sans frais saisis : affiché (« À venir ») mais pas encore à déclarer. */
  upcoming?: boolean;
};

export type ExpenseAttachment = { url: string; name: string; type: string | null };

export type ExpenseLine = {
  id: string;
  event_id: string | null;
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
  merchant_name: string | null;
  expense_date: string | null;
  total_amount: number | null;
  file_url: string | null;
  created_at: string;
  attachments: ExpenseAttachment[];
};

export type SubmissionToReview = {
  submissionId: string;
  status: ExpenseStatus;
  total: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerComment: string | null;
  person: { id: string; name: string; email: string | null };
  /** `id` nul : frais hors événement du mois `start`. */
  event: { id: string | null; title: string; start: string; eventType: DbEventType | null };
  lines: ExpenseLine[];
  attachments: ExpenseAttachment[];
};

/** Ligne à créer (saisie manuelle, justificatif lu par Claude, import). */
export type NewExpenseLine = {
  eventId: string | null;
  category: ExpenseCategory;
  amount: number;
  /** 'YYYY-MM-DD' */
  date: string | null;
  merchant: string | null;
  description: string | null;
  distanceKm: number | null;
  attachments: { url: string; type: string | null }[];
};

type Service = ReturnType<typeof createServiceClient>;


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


const MONTH_RE = /^\d{4}-\d{2}$/;

/** [début, fin[ d'un mois 'YYYY-MM', au format date. */
function monthRange(month: string): [string, string] {
  if (!MONTH_RE.test(month)) throw new Error("Mois invalide.");
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [`${month}-01`, `${next}-01`];
}


/** Lignes d'une personne pour une fiche (événement, ou hors événement sur un mois). */
async function linesOf(service: Service, userId: string, target: ExpenseTarget) {
  const q = service.from("event_expenses").select("*").eq("user_id", userId);
  if ("eventId" in target) return (await q.eq("event_id", target.eventId)).data ?? [];
  const [from, to] = monthRange(target.month);
  const { data } = await q
    .is("event_id", null)
    .or(`and(expense_date.gte.${from},expense_date.lt.${to}),and(expense_date.is.null,created_at.gte.${from},created_at.lt.${to})`);
  return data ?? [];
}

async function submissionOf(service: Service, userId: string, target: ExpenseTarget) {
  const q = service
    .from("expense_submissions")
    .select("id, status, reviewed_by, reviewed_at, reviewer_comments, reviewer_comment")
    .eq("user_id", userId);
  const { data } =
    "eventId" in target ? await q.eq("event_id", target.eventId).maybeSingle() : await q.is("event_id", null).eq("period_month", target.month).maybeSingle();
  return data;
}

/** Justificatifs des lignes : file_url de la ligne + pièces jointes. */
async function withAttachments(service: Service, lines: Record<string, unknown>[]): Promise<ExpenseLine[]> {
  const ids = lines.map((l) => l.id as string);
  const { data: atts } = ids.length
    ? await service.from("event_expense_attachments").select("expense_id, file_url, file_type").in("expense_id", ids).order("created_at")
    : { data: [] as { expense_id: string | null; file_url: string; file_type: string | null }[] };
  return lines.map((l) => {
    const own = (atts ?? []).filter((a) => a.expense_id === l.id);
    const attachments: ExpenseAttachment[] = [];
    if (l.file_url && !own.some((a) => a.file_url === l.file_url)) attachments.push({ url: l.file_url as string, name: "Justificatif", type: null });
    own.forEach((a, i) => attachments.push({ url: a.file_url, name: own.length > 1 ? `Justificatif ${i + 1}` : "Justificatif", type: a.file_type }));
    return { ...(l as unknown as Omit<ExpenseLine, "attachments">), attachments };
  });
}

/** Mes frais (voir computeMyExpenses) pour l'utilisateur connecté. */
export async function getMyExpenses(): Promise<MyExpenseItem[]> {
  const { userId, service } = await currentUser();
  return computeMyExpenses(service, userId);
}

async function notify(service: Service, userIds: string[], title: string, message: string, data: Record<string, unknown>) {
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

async function targetTitle(service: Service, target: ExpenseTarget) {
  if ("month" in target) return `les frais hors événement de ${monthLabel(target.month).toLowerCase()}`;
  const { data } = await service.from("events").select("title").eq("id", target.eventId).single();
  return `« ${data?.title ?? "un événement"} »`;
}

/**
 * Déclare mes frais d'une fiche (ou « pas de frais », qui supprime les lignes saisies) : la
 * déclaration passe en attente de validation et mon N+1 est prévenu. Possible tant qu'elle n'est
 * pas validée (y compris après un refus).
 */
export async function declareExpenses(target: ExpenseTarget, noExpense = false): Promise<{ error: string | null }> {
  try {
    const { userId, service } = await currentUser();
    if ("month" in target && noExpense) throw new Error("« Pas de frais » ne concerne que les événements.");
    const existing = await submissionOf(service, userId, target);
    if (existing?.status === "approved") throw new Error("Ces frais sont déjà validés.");

    let lines = await linesOf(service, userId, target);
    if (noExpense && lines.length > 0) {
      const ids = lines.map((l) => l.id);
      await service.from("event_expense_attachments").delete().in("expense_id", ids);
      const { error } = await service.from("event_expenses").delete().in("id", ids).eq("user_id", userId);
      if (error) throw new Error(error.message);
      lines = [];
    }
    if (!noExpense && lines.length === 0) throw new Error("Ajoutez au moins une ligne de frais avant de déclarer.");

    const payload = {
      user_id: userId,
      event_id: "eventId" in target ? target.eventId : null,
      period_month: "month" in target ? target.month : null,
      expense_ids: lines.map((l) => l.id),
      total_amount: noExpense ? 0 : lines.reduce((n, l) => n + Number(l.total_amount ?? 0), 0),
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
      const { data: me } = await service.from("profiles").select("first_name, last_name, email, expense_validator_id").eq("id", userId).single();
      if (me?.expense_validator_id) {
        await notify(
          service,
          [me.expense_validator_id],
          "Frais à valider",
          `${personName(me)} a déclaré ${payload.total_amount.toFixed(2)} € pour ${await targetTitle(service, target)}.`,
          { kind: "expense_to_validate", event_id: payload.event_id, period_month: payload.period_month }
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
    .select("id, user_id, event_id, period_month, expense_ids, total_amount, status, submitted_at, reviewed_at, reviewer_comments, reviewer_comment")
    .in("status", status === "pending" ? ["pending", "revision_requested"] : [status])
    .order("submitted_at", { ascending: status === "pending", nullsFirst: false })
    .limit(200);
  if (userIds) q = q.in("user_id", userIds);
  const { data: subs } = await q;
  if (!subs?.length) return [];

  const personIds = [...new Set(subs.map((s) => s.user_id))];
  const eventIds = [...new Set(subs.map((s) => s.event_id).filter((id): id is string => !!id))];
  // Lignes hors événement : celles retenues au moment de la déclaration.
  const monthLineIds = subs.filter((s) => !s.event_id).flatMap((s) => s.expense_ids ?? []);
  const [{ data: people }, { data: events }, { data: eventLines }, { data: monthLines }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email").in("id", personIds),
    eventIds.length
      ? service.from("events").select("id, title, start_date, event_type").in("id", eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string; start_date: string; event_type: string | null }[] }),
    eventIds.length ? service.from("event_expenses").select("*").in("event_id", eventIds).in("user_id", personIds) : Promise.resolve({ data: [] }),
    monthLineIds.length ? service.from("event_expenses").select("*").in("id", monthLineIds) : Promise.resolve({ data: [] }),
  ]);
  const lines = await withAttachments(service, [...(eventLines ?? []), ...(monthLines ?? [])] as Record<string, unknown>[]);

  const peopleById = new Map((people ?? []).map((p) => [p.id, p]));
  const eventsById = new Map((events ?? []).map((e) => [e.id, e]));

  return subs
    .filter((s) => (s.event_id ? eventsById.has(s.event_id) : !!s.period_month))
    .map((s) => {
      const event = s.event_id ? eventsById.get(s.event_id)! : null;
      const person = peopleById.get(s.user_id);
      const myLines = event
        ? lines.filter((l) => l.event_id === s.event_id && (l as unknown as { user_id: string }).user_id === s.user_id)
        : lines.filter((l) => (s.expense_ids ?? []).includes(l.id));
      return {
        submissionId: s.id,
        status: toStatus(s.status),
        total: Number(s.total_amount ?? myLines.reduce((n, l) => n + Number(l.total_amount ?? 0), 0)),
        submittedAt: s.submitted_at,
        reviewedAt: s.reviewed_at,
        reviewerComment: s.reviewer_comments ?? s.reviewer_comment ?? null,
        person: { id: s.user_id, name: personName(person), email: person?.email ?? null },
        event: event
          ? { id: event.id, title: event.title, start: event.start_date, eventType: event.event_type as DbEventType | null }
          : { id: null, title: `Frais hors événement · ${monthLabel(s.period_month!)}`, start: `${s.period_month}-01T00:00:00.000Z`, eventType: null },
        lines: myLines,
        attachments: myLines.flatMap((l) => l.attachments),
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
    const { data: sub } = await service
      .from("expense_submissions")
      .select("id, user_id, event_id, period_month, total_amount")
      .eq("id", submissionId)
      .single();
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

    const what = await targetTitle(service, sub.event_id ? { eventId: sub.event_id } : { month: sub.period_month! });
    await notify(
      service,
      [sub.user_id],
      decision === "approved" ? "Frais validés" : "Frais refusés",
      decision === "approved"
        ? `Vos frais (${Number(sub.total_amount ?? 0).toFixed(2)} €) pour ${what} ont été validés.`
        : `Vos frais pour ${what} ont été refusés : ${comment.trim()}`,
      { kind: "expense_reviewed", event_id: sub.event_id, period_month: sub.period_month, decision }
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

/** Statut de ma déclaration pour une fiche (onglet Frais de la fiche et modal « Mes frais »). */
export async function getMyExpenseStatus(target: ExpenseTarget): Promise<{
  status: ExpenseStatus;
  reviewerName: string | null;
  reviewerComment: string | null;
  reviewedAt: string | null;
}> {
  const { userId, service } = await currentUser();
  const sub = await submissionOf(service, userId, target);
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

/** Mes lignes d'une fiche, avec leurs justificatifs. */
export async function getMyExpenseLines(target: ExpenseTarget): Promise<ExpenseLine[]> {
  const { userId, service } = await currentUser();
  const lines = await linesOf(service, userId, target);
  lines.sort((a, b) => (b.expense_date ?? b.created_at).localeCompare(a.expense_date ?? a.created_at));
  return withAttachments(service, lines as Record<string, unknown>[]);
}

/** Ajoute des lignes de frais (une catégorie chacune) et leurs justificatifs. */
export async function addExpenseLines(input: NewExpenseLine[]): Promise<{ error: string | null; ids: string[] }> {
  try {
    const { userId, service } = await currentUser();
    const scansPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/expense_scans/expense_scans/${userId}/`;
    const ids: string[] = [];
    for (const line of input) {
      if (!EXPENSE_CATEGORIES.includes(line.category)) throw new Error("Catégorie inconnue.");
      if (!(line.amount > 0) || line.amount > 100_000) throw new Error("Montant invalide.");
      if (line.date && !/^\d{4}-\d{2}-\d{2}$/.test(line.date)) throw new Error("Date invalide.");
      // Justificatifs : uniquement des fichiers déposés par la personne elle-même.
      if (line.attachments.some((a) => !a.url.startsWith(scansPrefix))) throw new Error("Justificatif non reconnu.");

      const target: ExpenseTarget = line.eventId ? { eventId: line.eventId } : { month: (line.date ?? new Date().toISOString()).slice(0, 7) };
      const sub = await submissionOf(service, userId, target);
      if (sub?.status === "approved") throw new Error("Ces frais sont déjà validés : impossible d'y ajouter une ligne.");

      const amount = Math.round(line.amount * 100) / 100;
      const byCategory: Partial<Record<ExpenseAmountColumn, number>> = { [CATEGORY_META[line.category].column]: amount };
      const { data, error } = await service
        .from("event_expenses")
        .insert({
          user_id: userId,
          event_id: line.eventId,
          ...byCategory,
          total_amount: amount,
          expense_date: line.date,
          merchant_name: line.merchant?.trim() || null,
          description: line.description?.trim() || null,
          other_fees_description: line.category === "other" ? line.description?.trim() || line.merchant?.trim() || null : null,
          distance_km: line.distanceKm,
          file_url: line.attachments[0]?.url ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (line.attachments.length) {
        const { error: attErr } = await service
          .from("event_expense_attachments")
          .insert(line.attachments.map((a) => ({ expense_id: data.id, file_url: a.url, file_type: a.type })));
        if (attErr) throw new Error(attErr.message);
      }
      ids.push(data.id);
    }
    // Copie des justificatifs dans le Drive (année / mois / événement), après la réponse.
    const toArchive: ReceiptToArchive[] = input.flatMap((l) =>
      l.attachments.map((a) => ({
        userId,
        eventId: l.eventId,
        date: l.date,
        category: l.category,
        merchant: l.merchant,
        amount: l.amount,
        url: a.url,
        type: a.type,
      }))
    );
    if (toArchive.length) after(() => archiveReceipts(toArchive));
    return { error: null, ids };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue.", ids: [] };
  }
}

/** Supprime une de mes lignes (tant que la fiche n'est pas validée). */
export async function deleteExpenseLine(lineId: string): Promise<{ error: string | null }> {
  try {
    const { userId, service } = await currentUser();
    const { data: line } = await service
      .from("event_expenses")
      .select("id, event_id, expense_date, created_at")
      .eq("id", lineId)
      .eq("user_id", userId)
      .single();
    if (!line) throw new Error("Ligne introuvable.");
    const sub = await submissionOf(service, userId, line.event_id ? { eventId: line.event_id } : { month: lineMonth(line) });
    if (sub?.status === "approved") throw new Error("Ces frais sont déjà validés.");
    await service.from("event_expense_attachments").delete().eq("expense_id", lineId);
    const { error } = await service.from("event_expenses").delete().eq("id", lineId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
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

export type ExpenseExportLine = ExpenseLine & { eventTitle: string | null; eventDate: string | null; status: ExpenseStatus };

export type ExpenseExport = {
  month: string;
  person: { firstName: string; lastName: string; email: string | null; address: string | null; vehicle: string | null; plate: string | null };
  lines: ExpenseExportLine[];
};

/** Lien lisible par le navigateur d'un justificatif : URL publique, ou URL signée (chemins de l'appli calendrier). */
async function readableUrl(service: Service, url: string) {
  if (/^https?:\/\//.test(url)) return url;
  const bucket = url.startsWith("expense_scans/") ? "expense_scans" : "attachments";
  const { data } = await service.storage.from(bucket).createSignedUrl(url, 600);
  return data?.signedUrl ?? null;
}

/** Fiche individuelle de frais d'un mois ('YYYY-MM') : mes lignes (événements du mois + hors événement), pour l'export PDF / Excel. */
export async function getMyExpenseExport(month: string): Promise<ExpenseExport> {
  const { userId, service } = await currentUser();
  monthRange(month);
  const [items, { data: profile }] = await Promise.all([
    getMyExpenses(),
    service.from("profiles").select("first_name, last_name, email, home_address, license_plate, has_company_car").eq("id", userId).single(),
  ]);
  const inMonth = items.filter((i) => i.lineCount > 0 && i.start.slice(0, 7) === month);

  const lines: ExpenseExportLine[] = [];
  for (const item of inMonth) {
    const raw = await linesOf(service, userId, item.eventId ? { eventId: item.eventId } : { month: item.month! });
    for (const l of await withAttachments(service, raw as Record<string, unknown>[])) {
      const attachments = (
        await Promise.all(l.attachments.map(async (a) => ({ ...a, url: (await readableUrl(service, a.url)) ?? "" })))
      ).filter((a) => a.url);
      lines.push({ ...l, attachments, eventTitle: item.eventId ? item.title : null, eventDate: item.eventId ? item.start : null, status: item.status });
    }
  }
  const dateOf = (l: ExpenseExportLine) => l.eventDate ?? l.expense_date ?? l.created_at;
  lines.sort((a, b) => dateOf(a).localeCompare(dateOf(b)));

  return {
    month,
    person: {
      firstName: profile?.first_name ?? "",
      lastName: profile?.last_name ?? "",
      email: profile?.email ?? null,
      address: profile?.home_address ?? null,
      vehicle: profile?.has_company_car ? "Véhicule de service" : profile?.license_plate ? "Véhicule personnel" : null,
      plate: profile?.license_plate ?? null,
    },
    lines,
  };
}

/** Justificatif de frais tel qu'archivé dans le Drive (onglet Drive du board). */
export type ArchivedReceipt = {
  key: string;
  eventId: string | null;
  eventTitle: string | null;
  eventStart: string | null;
  /** 'YYYY-MM' — mois de rangement des frais hors événement. */
  month: string;
  name: string;
  url: string;
  type: string | null;
};

/**
 * Justificatifs visibles dans l'onglet Drive (24 derniers mois) : les miens et ceux des personnes
 * dont je suis le N+1 ; tous pour un administrateur ou un gestionnaire des frais.
 */
export async function getArchivedReceipts(): Promise<ArchivedReceipt[]> {
  const { userId, canManageValidators, service } = await currentUser();
  let userIds: string[] | null = null;
  if (!canManageValidators) {
    const { data: reports } = await service.from("profiles").select("id").eq("expense_validator_id", userId);
    userIds = [userId, ...(reports ?? []).map((r) => r.id)];
  }

  const since = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const { data: atts } = await service.from("event_expense_attachments").select("expense_id").gte("created_at", since);
  const withFiles = [...new Set((atts ?? []).map((a) => a.expense_id).filter((id): id is string => !!id))];

  let byFileUrl = service.from("event_expenses").select("*").not("file_url", "is", null).gte("created_at", since);
  let byAttachment = service.from("event_expenses").select("*").in("id", withFiles.length ? withFiles : ["00000000-0000-0000-0000-000000000000"]);
  if (userIds) {
    byFileUrl = byFileUrl.in("user_id", userIds);
    byAttachment = byAttachment.in("user_id", userIds);
  }
  const [{ data: a }, { data: b }] = await Promise.all([byFileUrl, byAttachment]);
  const lines = [...new Map([...(a ?? []), ...(b ?? [])].map((l) => [l.id, l])).values()];
  if (!lines.length) return [];

  const full = await withAttachments(service, lines as Record<string, unknown>[]);
  const personIds = [...new Set(lines.map((l) => l.user_id).filter((id): id is string => !!id))];
  const eventIds = [...new Set(lines.map((l) => l.event_id).filter((id): id is string => !!id))];
  const [{ data: people }, { data: events }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email").in("id", personIds),
    eventIds.length ? service.from("events").select("id, title, start_date").in("id", eventIds) : Promise.resolve({ data: [] as { id: string; title: string; start_date: string }[] }),
  ]);
  const personById = new Map((people ?? []).map((p) => [p.id, personName(p)]));
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  const receipts: ArchivedReceipt[] = [];
  for (const line of full) {
    const raw = lines.find((l) => l.id === line.id)!;
    const event = line.event_id ? eventById.get(line.event_id) : null;
    const parts = lineParts(line).map((p) => p.label.replace(/ \(.*\)$/, ""));
    const label = [
      line.expense_date ?? raw.created_at.slice(0, 10),
      personById.get(raw.user_id ?? "") ?? "—",
      parts.join(", "),
      raw.merchant_name ?? "",
      `${Number(raw.total_amount ?? 0).toFixed(2).replace(".", ",")} €`,
    ]
      .filter(Boolean)
      .join(" - ");
    for (const [i, att] of line.attachments.entries()) {
      const url = await readableUrl(service, att.url);
      if (!url) continue;
      receipts.push({
        key: `${line.id}:${i}`,
        eventId: event?.id ?? null,
        eventTitle: event?.title ?? null,
        eventStart: event?.start_date ?? null,
        month: lineMonth(raw),
        name: line.attachments.length > 1 ? `${label} (${i + 1})` : label,
        url,
        type: att.type,
      });
    }
  }
  return receipts.sort((x, y) => y.name.localeCompare(x.name));
}
