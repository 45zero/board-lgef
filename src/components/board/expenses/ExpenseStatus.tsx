"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, AlertCircle, MinusCircle } from "lucide-react";
import { declareExpenses, getMyExpenseStatus, type ExpenseStatus } from "@/app/actions/expenses";
import { targetKey, type ExpenseTarget } from "@/lib/board/expenseCategories";

export const EXPENSE_STATUS_META: Record<ExpenseStatus, { label: string; className: string; icon: typeof Clock }> = {
  a_declarer: { label: "À déclarer", className: "bg-warn-bg text-warn", icon: AlertCircle },
  pending: { label: "En attente", className: "bg-sel-bg text-link", icon: Clock },
  approved: { label: "Validé", className: "bg-good-bg text-good", icon: CheckCircle2 },
  rejected: { label: "Refusé", className: "bg-bad-bg text-bad", icon: XCircle },
  no_expense: { label: "Pas de frais", className: "bg-subtle text-ink-3", icon: MinusCircle },
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  const meta = EXPENSE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}

export const formatEuros = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
/** Montant dans une devise quelconque (code ISO), ex. « 60,00 $US ». */
export const formatMoney = (n: number, currency: string | null | undefined) => {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2).replace(".", ",")} ${currency}`;
  }
};
/** Ligne en devise étrangère pas encore convertie en euros. */
export const needsConversion = (l: { currency: string | null; exchange_rate: number | null }) =>
  !!l.currency && l.currency.toUpperCase() !== "EUR" && l.exchange_rate == null;

/** Confirme « Pas de frais » (les lignes déjà saisies sont supprimées). */
export const confirmNoExpense = (lineCount: number) =>
  confirm(
    lineCount > 0
      ? `Déclarer qu'il n'y a aucun frais pour cet événement ? Les ${lineCount} ligne(s) saisie(s) seront supprimées.`
      : "Déclarer qu'il n'y a aucun frais pour cet événement ?"
  );

/**
 * Bas d'une fiche de frais : statut de ma déclaration (et motif d'un refus), puis « Déclarer »
 * (envoie au N+1) ou « Pas de frais » (événements uniquement, y compris après un refus). Utilisé
 * dans l'onglet Frais de la fiche événement et dans le modal de « Mes frais ».
 */
export function DeclarationBar({ target, total, lineCount, onDone }: { target: ExpenseTarget; total: number; lineCount: number; onDone?: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getMyExpenseStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = targetKey(target);
  // La cible est un objet recréé à chaque rendu : on se fie à sa clé.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => getMyExpenseStatus(target).then(setInfo).catch(() => undefined), [key]);
  useEffect(() => {
    void load();
  }, [load]);

  const declare = async (noExpense: boolean) => {
    if (noExpense && !confirmNoExpense(lineCount)) return;
    setBusy(true);
    setError(null);
    const res = await declareExpenses(target, noExpense);
    setBusy(false);
    if (res.error) return setError(res.error);
    await load();
    onDone?.();
  };

  if (!info) return null;
  const locked = info.status === "approved";
  const alreadySent = info.status === "pending";

  return (
    <div className="space-y-2 rounded-panel border border-line bg-subtle/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <ExpenseStatusBadge status={info.status} />
        {info.reviewerName && info.reviewedAt && (
          <span>
            {info.status === "approved" ? "Validé" : info.status === "rejected" ? "Refusé" : "Revu"} par {info.reviewerName} le{" "}
            {new Date(info.reviewedAt).toLocaleDateString("fr-FR")}
          </span>
        )}
      </div>
      {info.status === "rejected" && info.reviewerComment && (
        <p className="rounded-btn bg-bad-bg px-2.5 py-1.5 text-xs text-bad">Motif : {info.reviewerComment}</p>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
      {!locked && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {"eventId" in target && info.status !== "no_expense" && (lineCount === 0 || info.status === "rejected") && (
            <button
              disabled={busy}
              onClick={() => declare(true)}
              className="rounded-btn border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 disabled:opacity-50"
            >
              Pas de frais
            </button>
          )}
          <button
            disabled={busy || lineCount === 0}
            onClick={() => declare(false)}
            className="rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? "Envoi…" : alreadySent ? `Mettre à jour la déclaration (${formatEuros(total)})` : `Déclarer ${formatEuros(total)}`}
          </button>
        </div>
      )}
    </div>
  );
}
