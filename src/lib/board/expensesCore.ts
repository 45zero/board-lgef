import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { DbEventType } from "@/lib/board/calendar";
import { getSolicitations } from "@/lib/board/solicitation";
import { monthLabel } from "@/lib/board/expenseCategories";
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

/** Mois d'une ligne hors événement : sa date de dépense, à défaut sa date de saisie. */
export const lineMonth = (l: { expense_date: string | null; created_at: string }) => (l.expense_date ?? l.created_at).slice(0, 7);

/** Déclarations en attente des personnes dont `userId` est le N+1. */
export async function countPendingForValidator(service: Service, userId: string): Promise<number> {
  const { data: reports } = await service.from("profiles").select("id").eq("expense_validator_id", userId);
  const ids = (reports ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { count } = await service
    .from("expense_submissions")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "revision_requested"])
    .in("user_id", ids);
  return count ?? 0;
}

/**
 * Mes frais : les événements (12 derniers mois) où je suis sollicité — membre ou responsable
 * d'équipe, assigné, comité directeur à la présence confirmée, technicien ayant accepté la
 * captation — ou où j'ai saisi des frais / une déclaration, plus mes frais hors événement par mois.
 */
export async function computeMyExpenses(service: Service, userId: string): Promise<MyExpenseItem[]> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();

  // Frais : seulement les sollicitations effectives (présence confirmée, captation acceptée).
  const [roles, submissions, allLines] = await Promise.all([
    getSolicitations(service, userId),
    service
      .from("expense_submissions")
      .select("id, event_id, period_month, status, submitted_at, reviewed_at, reviewed_by, reviewer_comments, reviewer_comment")
      .eq("user_id", userId),
    service.from("event_expenses").select("event_id, total_amount, expense_date, created_at, currency, exchange_rate").eq("user_id", userId).gte("created_at", since),
  ]);

  const subs = submissions.data ?? [];
  const subByEvent = new Map(subs.filter((s) => s.event_id).map((s) => [s.event_id as string, s]));
  const subByMonth = new Map(subs.filter((s) => !s.event_id && s.period_month).map((s) => [s.period_month as string, s]));

  const totals = new Map<string, { total: number; count: number }>();
  const add = (key: string, amount: number) => {
    const cur = totals.get(key) ?? { total: 0, count: 0 };
    totals.set(key, { total: cur.total + amount, count: cur.count + 1 });
  };
  // Ligne en devise étrangère pas encore convertie : comptée dans les lignes, pas dans le total en euros.
  const euros = (l: { total_amount: number | null; currency: string | null; exchange_rate: number | null }) =>
    l.currency && l.currency.toUpperCase() !== "EUR" && l.exchange_rate == null ? 0 : Number(l.total_amount ?? 0);
  for (const l of allLines.data ?? []) add(l.event_id ? `event:${l.event_id}` : `month:${lineMonth(l)}`, euros(l));

  const withLines = [...totals.keys()].filter((k) => k.startsWith("event:")).map((k) => k.slice(6));
  const eventIds = [...new Set([...roles.keys(), ...subByEvent.keys(), ...withLines])];
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
  const subFields = (sub: (typeof subs)[number] | undefined) => ({
    status: toStatus(sub?.status),
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
        month: null,
        title: e.title,
        start: e.start_date,
        end: e.end_date,
        eventType: e.event_type as DbEventType | null,
        roles: [...(roles.get(e.id) ?? [])],
        total: t.total,
        lineCount: t.count,
        ...subFields(subByEvent.get(e.id)),
      };
    });

  const months = new Set([...[...totals.keys()].filter((k) => k.startsWith("month:")).map((k) => k.slice(6)), ...subByMonth.keys()]);
  const monthItems: MyExpenseItem[] = [...months].map((m) => {
    const t = totals.get(`month:${m}`) ?? { total: 0, count: 0 };
    return {
      key: `month:${m}`,
      eventId: null,
      month: m,
      title: `Frais hors événement · ${monthLabel(m)}`,
      start: `${m}-01T00:00:00.000Z`,
      end: `${m}-01T00:00:00.000Z`,
      eventType: null,
      roles: [],
      total: t.total,
      lineCount: t.count,
      ...subFields(subByMonth.get(m)),
    };
  });

  return [...eventItems, ...monthItems].sort((a, b) => b.start.localeCompare(a.start));
}

