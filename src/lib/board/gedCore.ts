import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { loadEngagements } from "@/lib/board/staffCore";
import { isEmptyDeclaration, personName } from "@/lib/board/expensesCore";
import { COMPTA_SLUG } from "@/lib/board/fraisFlavor";
import type { Engagement } from "@/lib/board/staff";

// Ce qui attend quelqu'un dans la GED, indépendamment de la session : tableau de bord (Mes actions),
// pastilles des onglets et programme de 7 h comptent la même chose.

type Service = ReturnType<typeof createServiceClient>;

export async function isCompta(service: Service, userId: string): Promise<boolean> {
  const { data } = await service.from("profile_specialties").select("user_id, specialties!inner(slug)").eq("user_id", userId).eq("specialties.slug", COMPTA_SLUG);
  return (data ?? []).length > 0;
}

/**
 * Prestataire : ses interventions confirmées et passées des 12 derniers mois sans facture
 * (`todo`) ou dont la facture a été refusée (`refused`).
 */
export async function myMissingInvoices(service: Service, userId: string): Promise<{ todo: Engagement[]; refused: Engagement[] }> {
  const now = new Date();
  const list = (await loadEngagements(service, [userId], new Date(now.getTime() - 365 * 86_400_000).toISOString(), now.toISOString())).filter((e) => e.confirmed);
  return { todo: list.filter((e) => !e.invoice), refused: list.filter((e) => e.invoice?.status === "rejected") };
}

export type InvoiceToValidate = { id: string; userId: string; personName: string; eventId: string | null; title: string; date: string; amount: number | null };

/**
 * Factures en attente que `userId` doit valider : celles de ses prestataires (il est leur N+1) et,
 * pour la compta, celles des prestataires sans N+1 (même règle que invoiceValidatorIds).
 */
export async function invoicesToValidate(service: Service, userId: string, compta: boolean): Promise<InvoiceToValidate[]> {
  const { data: invs } = await service
    .from("event_invoices")
    .select("id, user_id, event_id, label, amount_ttc, invoice_date, created_at")
    .eq("status", "pending")
    .order("created_at")
    .limit(300);
  const rows = (invs ?? []).filter((r) => r.user_id && r.user_id !== userId);
  if (!rows.length) return [];
  const userIds = [...new Set(rows.map((r) => r.user_id!))];
  const eventIds = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => !!id))];
  const [{ data: people }, { data: events }] = await Promise.all([
    service.from("profiles").select("id, first_name, last_name, email, expense_validator_id").in("id", userIds),
    eventIds.length ? service.from("events").select("id, title, start_date").in("id", eventIds) : Promise.resolve({ data: [] as { id: string; title: string; start_date: string }[] }),
  ]);
  const personBy = new Map((people ?? []).map((p) => [p.id, p]));
  const eventBy = new Map((events ?? []).map((e) => [e.id, e]));
  return rows
    .filter((r) => {
      const validator = personBy.get(r.user_id!)?.expense_validator_id;
      return validator === userId || (compta && (!validator || validator === r.user_id));
    })
    .map((r) => {
      const ev = r.event_id ? eventBy.get(r.event_id) : null;
      return {
        id: r.id,
        userId: r.user_id!,
        personName: personName(personBy.get(r.user_id!)),
        eventId: ev ? r.event_id : null,
        title: ev?.title ?? r.label ?? "Facture hors intervention",
        date: ev?.start_date ?? `${r.invoice_date ?? (r.created_at ?? "").slice(0, 10)}T12:00:00.000Z`,
        amount: r.amount_ttc === null ? null : Number(r.amount_ttc),
      };
    });
}

/** Compta : factures et notes de frais validées, pas encore payées / remboursées. */
export async function unpaidPayables(service: Service): Promise<{ invoices: number; expenses: number; total: number }> {
  const [{ data: invs }, { data: subs }] = await Promise.all([
    service.from("event_invoices").select("amount_ttc, payment_status").eq("status", "approved"),
    service.from("expense_submissions").select("total_amount, paid_at").eq("status", "approved").is("paid_at", null),
  ]);
  const dueInvoices = (invs ?? []).filter((r) => r.payment_status !== "paid");
  const dueExpenses = (subs ?? []).filter((r) => Number(r.total_amount ?? 0) > 0);
  return {
    invoices: dueInvoices.length,
    expenses: dueExpenses.length,
    total: [...dueInvoices.map((r) => r.amount_ttc), ...dueExpenses.map((r) => r.total_amount)].reduce<number>((n, a) => n + Number(a ?? 0), 0),
  };
}

/** Notes de frais en attente de tout le monde (compta), déclarations vides exclues. */
export async function countAllPendingExpenses(service: Service): Promise<number> {
  const { data } = await service.from("expense_submissions").select("status, total_amount, expense_ids").in("status", ["pending", "revision_requested"]);
  return (data ?? []).filter((s) => !isEmptyDeclaration(s)).length;
}
