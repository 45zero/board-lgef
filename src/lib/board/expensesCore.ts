import "server-only";
import { managerChain, teamOf } from "@/lib/board/hierarchy";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { DbEventType } from "@/lib/board/calendar";
import { getSolicitations } from "@/lib/board/solicitation";
import { lineLabel } from "@/lib/board/expenseCategories";
import type { ExpenseStatus, MyExpenseItem } from "@/app/actions/expenses";

// Calculs de frais indépendants de la session : utilisés par les actions serveur (utilisateur
// connecté) ET par l'envoi du programme de 7 h (pour chaque abonné, sans session).

type Service = ReturnType<typeof createServiceClient>;
type Person = { id: string; first_name: string | null; last_name: string | null; email: string | null };

export const personName = (p: Pick<Person, "first_name" | "last_name" | "email"> | null | undefined) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—" : "—";

export function toStatus(s: string | null | undefined): ExpenseStatus {
  if (s === "pending" || s === "revision_requested") return "pending";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "no_expense") return "no_expense";
  return "a_declarer";
}

type SubmissionLike = { status: string | null; total_amount: number | string | null; expense_ids: string[] | null };

/**
 * Déclaration « en attente » sans aucune ligne ni montant : l'ancienne appli calendrier l'envoyait
 * quand on validait une fiche vide. Elle vaut « pas de frais » : rien à valider ni à payer.
 */
export const isEmptyDeclaration = (s: SubmissionLike) =>
  (s.status === "pending" || s.status === "revision_requested") && Number(s.total_amount ?? 0) === 0 && !(s.expense_ids ?? []).length;

/** Statut affiché d'une déclaration, déclaration vide comprise (voir isEmptyDeclaration). */
export const submissionStatus = (s: SubmissionLike | null | undefined): ExpenseStatus => (s && isEmptyDeclaration(s) ? "no_expense" : toStatus(s?.status));

/** Prestataire (spécialité tech-prestataire) : il facture ses interventions au lieu de déclarer des frais. */
export async function isPrestataire(service: Service, userId: string): Promise<boolean> {
  const { data } = await service.from("profile_specialties").select("user_id, specialties!inner(slug)").eq("user_id", userId).eq("specialties.slug", "tech-prestataire");
  return (data ?? []).length > 0;
}

/** Mode de déclaration des frais (profiles.notification_prefs.frais_declaration) : « auto » par défaut. */
export async function fraisDeclarationMode(service: Service, userId: string): Promise<"auto" | "manuel"> {
  const { data } = await service.from("profiles").select("notification_prefs").eq("id", userId).maybeSingle();
  return (data?.notification_prefs as { frais_declaration?: string } | null)?.frais_declaration === "manuel" ? "manuel" : "auto";
}

/** Mois d'une ligne hors événement : sa date de dépense, à défaut sa date de saisie. */
export const lineMonth = (l: { expense_date: string | null; created_at: string }) => (l.expense_date ?? l.created_at).slice(0, 7);

/** Déclarations en attente des personnes dont `userId` valide les frais (N+1, N+2…, délégation). */
export async function countPendingForValidator(service: Service, userId: string): Promise<number> {
  const ids = await teamOf(service, "frais", userId);
  if (ids.length === 0) return 0;
  const { data } = await service
    .from("expense_submissions")
    .select("status, total_amount, expense_ids")
    .in("status", ["pending", "revision_requested"])
    .in("user_id", ids);
  return (data ?? []).filter((s) => !isEmptyDeclaration(s)).length;
}

/**
 * Mes frais : les événements (12 derniers mois) où je suis sollicité — membre ou responsable
 * d'équipe, assigné, comité directeur à la présence confirmée, technicien ayant accepté la
 * captation —, mes propres événements Perso (« Pas de frais » s'il n'y en a pas), ou ceux où j'ai
 * saisi des frais / une déclaration, plus chacune de mes dépenses hors événement (une fiche par
 * dépense : déclarée, validée et payée seule).
 * Un prestataire facture ses interventions (Mes factures) : seuls les événements où il a saisi des
 * frais ou déclaré quelque chose sont listés, rien n'est « à déclarer » d'office. Même chose pour qui a
 * choisi la déclaration manuelle (fraisDeclarationMode) : il saisit ses frais et les rattache lui-même.
 */
export async function computeMyExpenses(service: Service, userId: string): Promise<MyExpenseItem[]> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();

  // Frais : seulement les sollicitations effectives (présence confirmée, captation acceptée).
  const [roles, submissions, allLines, isPresta, perso, mode] = await Promise.all([
    getSolicitations(service, userId),
    service
      .from("expense_submissions")
      .select("id, event_id, expense_id, period_month, status, total_amount, expense_ids, submitted_at, reviewed_at, reviewed_by, reviewer_comments, reviewer_comment")
      .eq("user_id", userId),
    service
      .from("event_expenses")
      .select("*") // toutes les colonnes montant, indemnités kilométriques comprises (lineLabel)
      .eq("user_id", userId)
      .gte("created_at", since),
    isPrestataire(service, userId),
    // Mes événements Perso (event_type « kanban » réutilisé pour Perso, cf. calendar.ts).
    service.from("events").select("id").eq("created_by", userId).eq("event_type", "kanban").gte("start_date", since),
    fraisDeclarationMode(service, userId),
  ]);
  // Rien d'office : prestataire, ou déclaration manuelle choisie.
  const prestataire = isPresta || mode === "manuel";
  for (const e of perso.data ?? []) {
    if (!roles.has(e.id)) roles.set(e.id, new Set());
    roles.get(e.id)!.add("Perso");
  }

  const subs = submissions.data ?? [];
  const subByEvent = new Map(subs.filter((s) => s.event_id).map((s) => [s.event_id as string, s]));
  const subByLine = new Map(subs.filter((s) => !s.event_id && s.expense_id).map((s) => [s.expense_id as string, s]));

  const totals = new Map<string, { total: number; count: number }>();
  const add = (key: string, amount: number) => {
    const cur = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: cur.total + amount, count: cur.count + 1 });
  };
  // Ligne en devise étrangère pas encore convertie : comptée dans les lignes, pas dans le total en euros.
  const euros = (l: { total_amount: number | null; currency: string | null; exchange_rate: number | null }) =>
    l.currency && l.currency.toUpperCase() !== "EUR" && l.exchange_rate == null ? 0 : Number(l.total_amount ?? 0);
  const offEvent = (allLines.data ?? []).filter((l) => !l.event_id);
  for (const l of allLines.data ?? []) if (l.event_id) add(`event:${l.event_id}`, euros(l));

  const withLines = [...totals.keys()].filter((k) => k.startsWith("event:")).map((k) => k.slice(6));
  const declared = [...subByEvent.entries()].filter(([, s]) => !prestataire || !isEmptyDeclaration(s)).map(([id]) => id);
  const eventIds = [...new Set([...(prestataire ? [] : roles.keys()), ...declared, ...withLines])];
  const { data: events } = eventIds.length
    ? await service
        .from("events")
        .select("id, title, start_date, end_date, event_type")
        .in("id", eventIds)
        .gte("start_date", since)
        .order("start_date", { ascending: false })
    : { data: [] };

  const reviewerIds = [...new Set(subs.map((s) => s.reviewed_by).filter((id): id is string => !!id))];
  const { data: reviewers } = reviewerIds.length
    ? await service.from("profiles").select("id, first_name, last_name, email").in("id", reviewerIds)
    : { data: [] as Person[] };
  const reviewerById = new Map((reviewers ?? []).map((r) => [r.id, r]));

  const now = new Date().toISOString();
  // Déclaration vide puis frais saisis : de nouveau à déclarer.
  const subFields = (sub: (typeof subs)[number] | undefined, lineCount: number) => ({
    status: sub && isEmptyDeclaration(sub) && lineCount > 0 ? ("a_declarer" as const) : submissionStatus(sub),
    submissionId: sub?.id ?? null,
    submittedAt: sub?.submitted_at ?? null,
    reviewedAt: sub?.reviewed_at ?? null,
    reviewerName: sub?.reviewed_by ? personName(reviewerById.get(sub.reviewed_by)) : null,
    reviewerComment: sub?.reviewer_comments ?? sub?.reviewer_comment ?? null,
  });

  const eventItems: MyExpenseItem[] = (events ?? [])
    // Événements à venir où je suis sollicité : listés (frais anticipés, hôtel réservé…) mais pas
    // « à déclarer » tant qu'ils n'ont pas eu lieu et qu'aucun frais n'est saisi.
    .map((e) => {
      const t = totals.get(`event:${e.id}`) ?? { total: 0, count: 0 };
      return {
        upcoming: e.start_date > now && t.count === 0 && !subByEvent.has(e.id),
        key: `event:${e.id}`,
        eventId: e.id,
        lineId: null,
        title: e.title,
        start: e.start_date,
        end: e.end_date,
        eventType: e.event_type as DbEventType | null,
        roles: [...(roles.get(e.id) ?? [])],
        total: t.total,
        lineCount: t.count,
        ...subFields(subByEvent.get(e.id), t.count),
      };
    });

  // Une fiche par dépense hors événement.
  const lineItems: MyExpenseItem[] = offEvent.map((l) => {
    const day = l.expense_date ? `${l.expense_date.slice(0, 10)}T12:00:00.000Z` : l.created_at;
    return {
      key: `line:${l.id}`,
      eventId: null,
      lineId: l.id,
      title: lineLabel(l),
      start: day,
      end: day,
      eventType: null,
      roles: [],
      total: euros(l),
      lineCount: 1,
      ...subFields(subByLine.get(l.id), 1),
    };
  });

  return [...eventItems, ...lineItems].sort((a, b) => b.start.localeCompare(a.start));
}


/** Jours sans validation avant de relancer le N+2. */
export const EXPENSE_ESCALATE_AFTER_DAYS = 7;

/**
 * Relance au N+2 les notes de frais en attente depuis EXPENSE_ESCALATE_AFTER_DAYS jours (déclarées
 * il y a entre 7 et 8 jours : appelé une fois par jour par le cron daily-digest, chaque note n'est
 * relancée qu'une fois). Un seul message par N+2. Sans N+2 : rien (les administrateurs voient tout).
 */
export async function escalateExpenses(service: Service): Promise<number> {
  const day = 86_400_000;
  const to = new Date(Date.now() - EXPENSE_ESCALATE_AFTER_DAYS * day).toISOString();
  const from = new Date(Date.now() - (EXPENSE_ESCALATE_AFTER_DAYS + 1) * day).toISOString();
  const { data: subs } = await service.from("expense_submissions").select("user_id, total_amount").eq("status", "pending").gte("submitted_at", from).lt("submitted_at", to);
  if (!subs?.length) return 0;
  const byN2 = new Map<string, { people: Set<string>; count: number; total: number }>();
  for (const userId of new Set(subs.map((s) => s.user_id))) {
    const n2 = (await managerChain(service, userId))[1];
    if (!n2) continue;
    const mine = subs.filter((s) => s.user_id === userId);
    const entry = byN2.get(n2) ?? { people: new Set<string>(), count: 0, total: 0 };
    entry.people.add(userId);
    entry.count += mine.length;
    entry.total += mine.reduce((n, s) => n + Number(s.total_amount ?? 0), 0);
    byN2.set(n2, entry);
  }
  if (!byN2.size) return 0;
  const { error } = await service.from("notifications").insert(
    [...byN2.entries()].map(([n2, e]) => ({
      user_id: n2,
      type: "expense_to_validate" as const,
      title: "Frais en attente dans votre équipe",
      message: `${e.count} note${e.count > 1 ? "s" : ""} de frais (${e.total.toFixed(2)} €) attend${e.count > 1 ? "ent" : ""} depuis ${EXPENSE_ESCALATE_AFTER_DAYS} jours la validation de leur N+1. Vous pouvez les valider dans Frais.`,
      data: { kind: "expense_to_validate", escalated: true, count: e.count },
    }))
  );
  if (error) throw new Error(error.message);
  return byN2.size;
}
