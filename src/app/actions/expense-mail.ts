"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { listConnectedAccounts } from "@/lib/google/accounts";
import { runExpenseMailRule, type ExpenseMailRule } from "@/lib/board/expenseMailImport";

// Frais → Paramètres → Factures par e-mail : règles de la personne connectée sur ses propres boîtes
// Gmail, journal des factures importées, « Vérifier maintenant ». Voir lib/board/expenseMailImport.ts.

export type MailRule = ExpenseMailRule & { accountEmail: string | null; last_checked_at: string | null; last_error: string | null };
export type MailImport = {
  id: string;
  created_at: string;
  mail_from: string | null;
  mail_subject: string | null;
  mail_date: string | null;
  attachment_name: string;
  status: "imported" | "ignored" | "error";
  detail: string | null;
  total: number | null;
};
export type MailRuleInput = { accountId: string; label: string; fromFilter: string; subjectFilter: string; matchEvents: boolean; enabled: boolean };

const RULE_COLUMNS = "id, user_id, account_id, label, from_filter, subject_filter, match_events, enabled, created_at, last_checked_at, last_error";

async function currentUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return userId;
}

/** Mes boîtes Gmail connectées, mes règles et les dernières factures traitées. */
export async function getExpenseMailSettings(): Promise<{ accounts: { id: string; email: string }[]; rules: MailRule[]; imports: MailImport[] }> {
  const userId = await currentUserId();
  const service = createServiceClient();
  const [accounts, { data: rules }, { data: imports }] = await Promise.all([
    listConnectedAccounts(userId),
    service.from("expense_mail_rules").select(RULE_COLUMNS).eq("user_id", userId).order("created_at"),
    service
      .from("expense_mail_imports")
      .select("id, created_at, mail_from, mail_subject, mail_date, attachment_name, status, detail, total")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const google = accounts.filter((a) => a.provider === "google");
  return {
    accounts: google.map((a) => ({ id: a.id, email: a.email })),
    rules: (rules ?? []).map((r) => ({ ...r, accountEmail: google.find((a) => a.id === r.account_id)?.email ?? null })),
    imports: (imports ?? []) as MailImport[],
  };
}

function clean(input: MailRuleInput) {
  const fromFilter = input.fromFilter.trim().slice(0, 200);
  const subjectFilter = input.subjectFilter.trim().slice(0, 200);
  if (!fromFilter && !subjectFilter) throw new Error("Indiquez un expéditeur ou des mots du sujet.");
  return {
    account_id: input.accountId,
    label: input.label.trim().slice(0, 80),
    from_filter: fromFilter,
    subject_filter: subjectFilter,
    match_events: input.matchEvents,
    enabled: input.enabled,
  };
}

/** Crée (sans id) ou modifie une de mes règles. */
export async function saveExpenseMailRule(id: string | null, input: MailRuleInput): Promise<{ error: string | null }> {
  try {
    const userId = await currentUserId();
    const row = clean(input);
    const accounts = await listConnectedAccounts(userId);
    if (!accounts.some((a) => a.id === row.account_id && a.provider === "google")) throw new Error("Choisissez une de vos boîtes Gmail connectées.");
    const service = createServiceClient();
    const { error } = id
      ? await service.from("expense_mail_rules").update(row).eq("id", id).eq("user_id", userId)
      : await service.from("expense_mail_rules").insert({ ...row, user_id: userId });
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

export async function deleteExpenseMailRule(id: string): Promise<{ error: string | null }> {
  try {
    const userId = await currentUserId();
    const { error } = await createServiceClient().from("expense_mail_rules").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** « Vérifier maintenant » : passe toutes mes règles actives tout de suite. */
export async function runMyExpenseMailRules(): Promise<{ error: string | null; imported: number; total: number; toConvert: number }> {
  try {
    const userId = await currentUserId();
    const service = createServiceClient();
    const { data: rules } = await service.from("expense_mail_rules").select(RULE_COLUMNS).eq("user_id", userId).eq("enabled", true);
    let imported = 0;
    let total = 0;
    let toConvert = 0;
    const errors: string[] = [];
    for (const rule of (rules ?? []) as ExpenseMailRule[]) {
      // Peu de mails à la fois (la page attend la réponse) : le reste passe avec le cron.
      const r = await runExpenseMailRule(service, rule, 3);
      imported += r.imported;
      total += r.total;
      toConvert += r.toConvert;
      if (r.error) errors.push(r.error);
    }
    return { error: errors[0] ?? null, imported, total, toConvert };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue.", imported: 0, total: 0, toConvert: 0 };
  }
}
