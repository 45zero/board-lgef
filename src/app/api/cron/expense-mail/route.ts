import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { notifyImported, runExpenseMailRule, type ExpenseMailRule } from "@/lib/board/expenseMailImport";

export const maxDuration = 300;

/** Règles passées au plus par appel (les moins récemment vérifiées d'abord). */
const BATCH = 20;

/**
 * Factures reçues par e-mail → frais — appelé toutes les 15 minutes par pg_cron (job « expense-mail »,
 * sql/2026-10-05_expense_mail_import.sql) avec le secret CRON_SECRET. Voir lib/board/expenseMailImport.ts.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const service = createServiceClient();
  const { data: rules, error } = await service
    .from("expense_mail_rules")
    .select("id, user_id, account_id, label, from_filter, subject_filter, match_events, enabled, created_at")
    .eq("enabled", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byUser = new Map<string, { count: number; total: number; toConvert: number }>();
  for (const rule of (rules ?? []) as ExpenseMailRule[]) {
    const r = await runExpenseMailRule(service, rule);
    const acc = byUser.get(rule.user_id) ?? { count: 0, total: 0, toConvert: 0 };
    byUser.set(rule.user_id, { count: acc.count + r.imported, total: acc.total + r.total, toConvert: acc.toConvert + r.toConvert });
  }
  for (const [userId, { count, total, toConvert }] of byUser) await notifyImported(service, userId, count, total, toConvert);
  return NextResponse.json({ rules: rules?.length ?? 0, imported: [...byUser.values()].reduce((n, u) => n + u.count, 0) });
}
