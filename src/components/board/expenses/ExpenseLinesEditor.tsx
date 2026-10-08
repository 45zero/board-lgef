"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Paperclip, Sparkles, Trash2, X, Loader2, FileText, ArrowRightLeft, AlertCircle } from "lucide-react";
import { addExpenseLines, convertExpenseLine, deleteExpenseLine, getMyExpenseLines, type ExpenseLine, type NewExpenseLine } from "@/app/actions/expenses";
import { scanReceipt, type ScannedExpense } from "@/app/actions/expense-scan";
import { CATEGORY_META, EXPENSE_CATEGORIES, lineParts, targetKey, type ExpenseCategory, type ExpenseTarget } from "@/lib/board/expenseCategories";
import { uploadReceipt, RECEIPT_ACCEPT } from "@/lib/board/receiptUpload";
import { DeclarationBar, formatEuros, formatMoney, needsConversion } from "@/components/board/expenses/ExpenseStatus";

type Attachment = { url: string; type: string; name: string };

const fmtDay = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "");
const input = "rounded-btn border border-line bg-card px-2.5 py-1.5 text-sm outline-none focus:border-link";

/** Liens vers les justificatifs d'une ligne. */
export function AttachmentLinks({ attachments }: { attachments: { url: string; name: string }[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-link hover:underline">
          <Paperclip size={11} /> {a.name}
        </a>
      ))}
    </div>
  );
}

/**
 * Montant d'une ligne : en euros ; une ligne en devise étrangère affiche son montant d'origine et,
 * tant qu'elle n'est pas convertie, le bouton « Convertir en € » (cours BCE du jour de la dépense).
 */
export function LineAmount({ line, onConvert }: { line: ExpenseLine; onConvert?: () => void }) {
  const [busy, setBusy] = useState(false);
  const amount = Number(line.total_amount ?? 0);
  if (needsConversion(line)) {
    return (
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-bold text-ink">{formatMoney(amount, line.currency)}</span>
        {onConvert ? (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await convertExpenseLine(line.id);
              setBusy(false);
              if (res.error) return alert(res.error);
              onConvert();
            }}
            title="Convertir en euros au cours de la BCE du jour de la dépense (la facture reste dans sa devise)"
            className="flex items-center gap-1 rounded-btn bg-red px-2 py-1 text-[11px] font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />} Convertir en €
          </button>
        ) : (
          <span className="text-[10px] font-semibold text-warn">À convertir en €</span>
        )}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-end">
      <span className="text-sm font-bold text-ink">{formatEuros(amount)}</span>
      {line.currency && line.exchange_rate != null && (
        <span className="text-[10px] text-ink-4" title={`Cours BCE${line.exchange_rate_date ? ` du ${fmtDay(line.exchange_rate_date)}` : ""}`}>
          {formatMoney(Number(line.original_amount ?? 0), line.currency)} · 1 = {Number(line.exchange_rate).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} €
        </span>
      )}
    </span>
  );
}

/** Boutons « Photo » (ouvre l'appareil photo sur mobile) et « Joindre » (fichiers). */
export function ReceiptButtons({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length) onFiles(files);
  };
  const btn = "flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50";
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()} className={btn}>
        <Camera size={14} /> Photo
      </button>
      <button type="button" disabled={disabled} onClick={() => fileRef.current?.click()} className={btn}>
        <Paperclip size={14} /> Joindre
      </button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple hidden onChange={pick} />
    </>
  );
}

/**
 * Lignes de frais d'une fiche (événement, ou hors événement sur un mois) : liste avec justificatifs,
 * ajout d'une ligne (catégorie, montant, date, fournisseur) avec photo ou pièce jointe lue par
 * Claude pour pré-remplir, puis la barre de déclaration au N+1.
 */
export function ExpenseLinesEditor({ target, locked = false, onChanged }: { target: ExpenseTarget; locked?: boolean; onChanged?: () => void }) {
  const eventId = "eventId" in target ? target.eventId : null;
  const [lines, setLines] = useState<ExpenseLine[] | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>("meal");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => ("month" in target ? `${target.month}-01` : new Date().toISOString().slice(0, 10)));
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  /** Devise lue sur le justificatif (EUR par défaut). */
  const [currency, setCurrency] = useState("EUR");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [extra, setExtra] = useState<ScannedExpense[]>([]);
  const [status, setStatus] = useState<"idle" | "upload" | "scan" | "save">("idle");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = targetKey(target);
  const load = useCallback(
    () =>
      getMyExpenseLines(target)
        .then(setLines)
        .catch(() => setLines([])),
    // La cible est un objet recréé à chaque rendu : on se fie à sa clé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setAmount("");
    setMerchant("");
    setDescription("");
    setCurrency("EUR");
    setAttachments([]);
    setExtra([]);
    setInfo(null);
  };

  const prefill = (e: ScannedExpense) => {
    setCategory(e.category);
    setAmount(String(e.amount));
    if (e.date) setDate(e.date);
    setMerchant(e.merchant ?? "");
    setDescription(e.description ?? "");
    setCurrency(e.currency || "EUR");
  };

  const onFiles = async (files: File[]) => {
    setError(null);
    setInfo(null);
    // Seul le premier justificatif d'une ligne vide est lu (les suivants sont de simples pièces jointes).
    let shouldScan = !amount && attachments.length === 0;
    for (const file of files) {
      try {
        setStatus("upload");
        const up = await uploadReceipt(file);
        setAttachments((prev) => [...prev, { url: up.url, type: up.type, name: file.name || "Photo" }]);
        if (shouldScan) {
          shouldScan = false;
          setStatus("scan");
          const res = await scanReceipt(up.path, eventId ? { eventId } : {});
          if (res.error) setInfo(res.error);
          else if (res.expenses.length) {
            prefill(res.expenses[0]);
            setExtra(res.expenses.slice(1));
            setInfo(
              res.expenses.length > 1
                ? `${res.expenses.length} dépenses lues : vérifiez la première, les autres s'ajoutent d'un clic.`
                : "Justificatif lu : vérifiez les informations avant d'ajouter."
            );
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Envoi impossible.");
      }
    }
    setStatus("idle");
  };

  const save = async (drafts: NewExpenseLine[]) => {
    setStatus("save");
    setError(null);
    const res = await addExpenseLines(drafts);
    setStatus("idle");
    if (res.error) return setError(res.error);
    reset();
    await load();
    onChanged?.();
  };

  const files = () => attachments.map((a) => ({ url: a.url, type: a.type }));
  const current = (): NewExpenseLine => ({
    eventId,
    category,
    amount: parseFloat(amount.replace(",", ".")),
    date: date || null,
    merchant: merchant || null,
    description: description || null,
    distanceKm: null,
    attachments: files(),
    currency,
  });

  const remove = async (id: string) => {
    if (!confirm("Supprimer cette ligne de frais ?")) return;
    const res = await deleteExpenseLine(id);
    if (res.error) return setError(res.error);
    await load();
    onChanged?.();
  };

  // Lignes en devise pas encore converties : hors du total en euros (et déclaration bloquée).
  const total = (lines ?? []).filter((l) => !needsConversion(l)).reduce((n, l) => n + Number(l.total_amount ?? 0), 0);
  const toConvert = (lines ?? []).filter(needsConversion).length;
  const amountValue = parseFloat(amount.replace(",", "."));
  const busy = status !== "idle";

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-extrabold text-ink">{formatEuros(total)}</div>
        {lines && <div className="text-xs text-ink-4">{lines.length} ligne{lines.length > 1 ? "s" : ""}</div>}
      </div>

      {lines === null ? (
        <p className="text-sm text-ink-4">Chargement…</p>
      ) : (
        lines.length > 0 && (
          <div className="overflow-hidden rounded-btn border border-line">
            {lines.map((l) => (
              <div key={l.id} className="flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 font-semibold text-ink">
                    {lineParts(l)
                      .map((p) => p.label.replace(/ \(.*\)$/, ""))
                      .join(" + ") || "Frais"}
                    {l.merchant_name && <span className="font-normal text-ink-3">· {l.merchant_name}</span>}
                  </div>
                  <div className="text-[11px] text-ink-4">
                    {fmtDay(l.expense_date ?? l.created_at)}
                    {(l.description || l.other_fees_description) && ` · ${l.description || l.other_fees_description}`}
                    {l.distance_km ? ` · ${l.distance_km} km` : ""}
                  </div>
                  <AttachmentLinks attachments={l.attachments} />
                </div>
                <LineAmount
                  line={l}
                  onConvert={
                    locked
                      ? undefined
                      : () => {
                          void load();
                          onChanged?.();
                        }
                  }
                />
                {!locked && (
                  <button onClick={() => remove(l.id)} title="Supprimer" className="shrink-0 rounded-full p-1 text-ink-4 hover:bg-bad-bg hover:text-bad">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {!locked && (
        <div className="space-y-2.5 rounded-panel border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-ink-2">Ajouter une dépense</div>
            <div className="flex items-center gap-1.5">
              <ReceiptButtons onFiles={onFiles} disabled={busy} />
            </div>
          </div>

          {(status === "upload" || status === "scan") && (
            <div className="flex items-center gap-2 rounded-btn bg-sel-bg px-3 py-2 text-xs font-semibold text-link">
              <Loader2 size={13} className="animate-spin" />
              {status === "upload" ? "Envoi du justificatif…" : "Lecture du justificatif par Claude…"}
            </div>
          )}
          {info && (
            <div className="flex items-start gap-2 rounded-btn bg-subtle px-3 py-2 text-xs text-ink-2">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-link" /> {info}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span key={a.url} className="flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                  <FileText size={11} />
                  <a href={a.url} target="_blank" rel="noreferrer" className="max-w-[160px] truncate hover:underline">
                    {a.name}
                  </a>
                  <button onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))} className="text-ink-4 hover:text-bad">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={`${input} col-span-2 sm:col-span-1`}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
            <div className="relative min-w-0">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={currency === "EUR" ? "Montant €" : `Montant ${currency}`}
                className={`${input} w-full ${currency === "EUR" ? "" : "pr-14"}`}
              />
              {currency !== "EUR" && (
                <button
                  type="button"
                  onClick={() => setCurrency("EUR")}
                  title="Montant lu dans cette devise : la ligne sera à convertir en euros. Cliquer pour saisir en euros."
                  className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-warn"
                >
                  {currency} <X size={9} />
                </button>
              )}
            </div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Fournisseur (enseigne, hôtel…)" className={input} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Précision (trajet, repas…)" className={input} />
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {extra.length > 0 && (
              <button
                disabled={busy || !(amountValue > 0)}
                onClick={() =>
                  save([
                    current(),
                    ...extra.map((e) => ({
                      eventId,
                      category: e.category,
                      amount: e.amount,
                      date: e.date,
                      merchant: e.merchant,
                      description: e.description,
                      distanceKm: e.distanceKm,
                      attachments: files(),
                      currency: e.currency,
                    })),
                  ])
                }
                className="rounded-btn border border-navy px-3 py-1.5 text-xs font-bold text-navy disabled:opacity-50"
              >
                Ajouter les {extra.length + 1} dépenses
              </button>
            )}
            <button
              disabled={busy || !(amountValue > 0)}
              onClick={() => save([current()])}
              className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {status === "save" ? "Ajout…" : "Ajouter la ligne"}
            </button>
          </div>
        </div>
      )}

      {toConvert > 0 && (
        <p className="flex items-center gap-1.5 rounded-btn bg-warn-bg px-3 py-2 text-xs font-semibold text-warn">
          <AlertCircle size={13} className="shrink-0" />
          {toConvert > 1 ? `${toConvert} lignes sont` : "Une ligne est"} en devise étrangère : convertissez-{toConvert > 1 ? "les" : "la"} en euros avant de déclarer.
        </p>
      )}

      {lines && <DeclarationBar key={`${key}:${lines.length}:${total}`} target={target} total={total} lineCount={lines.length} onDone={onChanged} />}
    </div>
  );
}
