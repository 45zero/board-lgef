import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { ReceiptToArchive } from "@/lib/board/expenseArchive";
import { CATEGORY_META, EXPENSE_CATEGORIES, type ExpenseAmountColumn, type ExpenseCategory } from "@/lib/board/expenseCategories";

// Création des lignes de frais d'une personne, commune à la saisie dans le board
// (actions/expenses.ts → addExpenseLines) et à l'import des factures reçues par e-mail
// (lib/board/expenseMailImport.ts) : mêmes contrôles, mêmes colonnes, même copie dans le Drive.

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
  /** Devise du montant (code ISO) si ce n'est pas l'euro : la ligne sera à convertir. */
  currency?: string | null;
};

/** Montant dans une autre devise que l'euro. */
export const isForeign = (currency: string | null | undefined) => !!currency && /^[A-Za-z]{3}$/.test(currency) && currency.toUpperCase() !== "EUR";

/** Préfixe des justificatifs déposés par une personne (bucket public expense_scans). */
export const receiptPrefix = (userId: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/expense_scans/expense_scans/${userId}/`;

/** Insère les lignes ; renvoie leurs identifiants et les justificatifs à copier dans le Drive. */
export async function insertExpenseLines(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  input: NewExpenseLine[]
): Promise<{ ids: string[]; toArchive: ReceiptToArchive[] }> {
  const prefix = receiptPrefix(userId);
  const ids: string[] = [];
  for (const line of input) {
    if (!EXPENSE_CATEGORIES.includes(line.category)) throw new Error("Catégorie inconnue.");
    if (!(line.amount > 0) || line.amount > 100_000) throw new Error("Montant invalide.");
    if (line.date && !/^\d{4}-\d{2}-\d{2}$/.test(line.date)) throw new Error("Date invalide.");
    if (line.currency && !/^[A-Za-z]{3}$/.test(line.currency)) throw new Error("Devise invalide.");
    // Justificatifs : uniquement des fichiers déposés par la personne elle-même.
    if (line.attachments.some((a) => !a.url.startsWith(prefix))) throw new Error("Justificatif non reconnu.");

    const q = service.from("expense_submissions").select("status").eq("user_id", userId);
    const { data: sub } = line.eventId
      ? await q.eq("event_id", line.eventId).maybeSingle()
      : await q.is("event_id", null).eq("period_month", (line.date ?? new Date().toISOString()).slice(0, 7)).maybeSingle();
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
        // Devise étrangère : montant d'origine gardé, ligne à convertir en euros avant de déclarer.
        ...(isForeign(line.currency) ? { currency: line.currency!.toUpperCase(), original_amount: amount } : {}),
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
  return { ids, toArchive };
}
