"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, X, Search, Sparkles, CalendarDays, Check, FileText, AlertCircle } from "lucide-react";
import { addExpenseLines } from "@/app/actions/expenses";
import { scanReceipt, searchEventsForExpense, type EventCandidate } from "@/app/actions/expense-scan";
import { CATEGORY_META, EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/board/expenseCategories";
import { uploadReceipt } from "@/lib/board/receiptUpload";
import { ReceiptButtons } from "@/components/board/expenses/ExpenseLinesEditor";
import { EventArrow } from "@/components/board/calendar/EventOpener";

type Draft = {
  id: string;
  fileName: string;
  fileUrl: string | null;
  fileType: string | null;
  state: "upload" | "scan" | "ready" | "saving" | "error";
  error: string | null;
  category: ExpenseCategory;
  amount: string;
  date: string;
  merchant: string;
  description: string;
  distanceKm: number | null;
  event: EventCandidate | null;
  /** Événement retenu automatiquement par le rapprochement. */
  auto: boolean;
  candidates: EventCandidate[];
};

const input = "min-w-0 rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-link";
const fmtEventDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const newId = () => Math.random().toString(36).slice(2);

/** Choix de l'événement d'une dépense : suggestions, recherche, ou « hors événement ». */
function EventPicker({ draft, onChange }: { draft: Draft; onChange: (event: EventCandidate | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EventCandidate[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      searchEventsForExpense(query, draft.date || null)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query, draft.date]);

  const pick = (e: EventCandidate | null) => {
    onChange(e);
    setOpen(false);
    setQuery("");
  };
  const list = query.trim() ? (results ?? []) : [...draft.candidates, ...(results ?? []).filter((r) => !draft.candidates.some((c) => c.id === r.id))];

  return (
    <div className="relative min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {draft.event ? (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-sel-bg py-0.5 pl-2.5 pr-0.5 text-xs font-semibold text-link">
            <CalendarDays size={12} className="shrink-0" />
            <span className="truncate">
              {draft.event.title} · {fmtEventDate(draft.event.start)}
            </span>
            {draft.auto && (
              <span title="Rapproché automatiquement" className="flex shrink-0 items-center gap-0.5 text-[10px] font-bold">
                <Sparkles size={10} /> auto
              </span>
            )}
            <EventArrow eventId={draft.event.id} className="h-6 w-6 bg-card" />
          </span>
        ) : (
          <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-3">Hors événement</span>
        )}
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-semibold text-link hover:underline">
          {draft.event ? "Changer" : "Rattacher à un événement"}
        </button>
      </div>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[min(420px,85vw)] rounded-btn border border-line bg-card p-2 shadow-modal">
          <div className="mb-1.5 flex items-center gap-2 rounded-btn border border-line px-2 py-1">
            <Search size={13} className="text-ink-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un événement (nom, lieu)…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button onClick={() => pick(null)} className="block w-full rounded-btn px-2 py-1.5 text-left text-sm text-ink-3 hover:bg-hover">
              Hors événement (frais du mois)
            </button>
            {results === null && <p className="px-2 py-1.5 text-xs text-ink-4">Recherche…</p>}
            {list.map((e) => (
              <button key={e.id} onClick={() => pick(e)} className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left hover:bg-hover">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                  <span className="block truncate text-[11px] text-ink-4">
                    {fmtEventDate(e.start)}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
                {e.solicited && <span className="shrink-0 rounded-full bg-good-bg px-1.5 py-0.5 text-[10px] font-bold text-good">Sollicité</span>}
              </button>
            ))}
            {results !== null && list.length === 0 && <p className="px-2 py-1.5 text-xs text-ink-4">Aucun événement trouvé.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyDraft = (fileName: string): Draft => ({
  id: newId(),
  fileName,
  fileUrl: null,
  fileType: null,
  state: "upload",
  error: null,
  category: "meal",
  amount: "",
  date: "",
  merchant: "",
  description: "",
  distanceKm: null,
  event: null,
  auto: false,
  candidates: [],
});

/**
 * Import de justificatifs en lot : glisser-déposer (ordinateur) ou photo (mobile) de tickets,
 * factures ou feuilles de frais. Chaque document est lu par Claude, chaque dépense est rapprochée
 * de l'événement correspondant (ou laissée hors événement), puis ajoutée après vérification.
 */
export function ExpenseImport({ onAdded }: { onAdded: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());

  const patch = (id: string, p: Partial<Draft>) => setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));

  const processFile = async (file: File, id: string) => {
    try {
      const up = await uploadReceipt(file);
      patch(id, { state: "scan", fileUrl: up.url, fileType: up.type });
      const res = await scanReceipt(up.path);
      if (res.error || res.expenses.length === 0) {
        patch(id, { state: "ready", error: res.error ?? "Aucune dépense reconnue : complétez à la main." });
        return;
      }
      // Un document peut contenir plusieurs dépenses (feuille de frais) : une fiche par dépense.
      const lines: Draft[] = res.expenses.map((e, i) => {
        const event = e.suggestedEventId ? (e.candidates.find((c) => c.id === e.suggestedEventId) ?? null) : null;
        return {
          id: i === 0 ? id : newId(),
          fileName: file.name || "Photo",
          fileUrl: up.url,
          fileType: up.type,
          state: "ready",
          error: null,
          category: e.category,
          amount: String(e.amount),
          date: e.date ?? "",
          merchant: e.merchant ?? "",
          description: e.description ?? "",
          distanceKm: e.distanceKm,
          event,
          auto: !!event,
          candidates: e.candidates,
        };
      });
      setDrafts((prev) => prev.flatMap((d) => (d.id === id ? lines : [d])));
    } catch (e) {
      patch(id, { state: "error", error: e instanceof Error ? e.message : "Envoi impossible." });
    }
  };

  const addFiles = (files: File[]) => {
    setError(null);
    const created = files.map((file) => ({ file, draft: emptyDraft(file.name || "Photo") }));
    setDrafts((prev) => [...prev, ...created.map((c) => c.draft)]);
    // Trois documents lus en parallèle au plus, dans l'ordre de dépôt.
    const pending = [...created];
    const worker = async () => {
      for (let next = pending.shift(); next; next = pending.shift()) await processFile(next.file, next.draft.id);
    };
    queue.current = queue.current.then(() => Promise.all([worker(), worker(), worker()]).then(() => undefined));
  };

  const valid = (d: Draft) => d.state === "ready" && parseFloat(d.amount.replace(",", ".")) > 0;

  const save = async (list: Draft[]) => {
    if (!list.length) return;
    const ids = new Set(list.map((l) => l.id));
    setError(null);
    setDrafts((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, state: "saving" } : d)));
    const res = await addExpenseLines(
      list.map((d) => ({
        eventId: d.event?.id ?? null,
        category: d.category,
        amount: parseFloat(d.amount.replace(",", ".")),
        date: d.date || null,
        merchant: d.merchant || null,
        description: d.description || null,
        distanceKm: d.distanceKm,
        attachments: d.fileUrl ? [{ url: d.fileUrl, type: d.fileType }] : [],
      }))
    );
    if (res.error) {
      setError(res.error);
      setDrafts((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, state: "ready" } : d)));
      return;
    }
    setDrafts((prev) => prev.filter((d) => !ids.has(d.id)));
    onAdded();
  };

  const ready = drafts.filter(valid);
  const working = drafts.some((d) => d.state === "upload" || d.state === "scan");

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = [...e.dataTransfer.files];
          if (files.length) addFiles(files);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-panel border-2 border-dashed px-4 py-3 transition-colors ${
          dragging ? "border-link bg-sel-bg" : "border-line bg-card"
        }`}
      >
        <Upload size={20} className="shrink-0 text-ink-4" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">Importer des justificatifs</div>
          <div className="text-[11px] text-ink-4">
            Glissez tickets, factures ou feuilles de frais (photo, PDF, Excel) : Claude les lit et les rattache à vos événements.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ReceiptButtons onFiles={addFiles} />
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="rounded-panel border border-line bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="text-xs font-bold text-ink-2">
              {drafts.length} dépense{drafts.length > 1 ? "s" : ""} à vérifier
              {working && (
                <span className="ml-2 inline-flex items-center gap-1 font-semibold text-link">
                  <Loader2 size={12} className="animate-spin" /> lecture en cours…
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setDrafts([])} className="text-xs font-semibold text-ink-4 hover:text-bad">
                Tout effacer
              </button>
              <button
                disabled={ready.length === 0}
                onClick={() => save(ready)}
                className="flex items-center gap-1 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white shadow-btn-red disabled:opacity-50"
              >
                <Check size={12} /> Ajouter {ready.length > 1 ? `les ${ready.length} dépenses` : "la dépense"}
              </button>
            </div>
          </div>
          {error && <p className="px-4 pt-2 text-xs text-bad">{error}</p>}
          {drafts.map((d) => (
            <div key={d.id} className="space-y-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <FileText size={14} className="shrink-0 text-ink-4" />
                {d.fileUrl ? (
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs font-semibold text-link hover:underline">
                    {d.fileName}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-3">{d.fileName}</span>
                )}
                {(d.state === "upload" || d.state === "scan" || d.state === "saving") && (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-link">
                    <Loader2 size={12} className="animate-spin" />
                    {d.state === "upload" ? "Envoi…" : d.state === "scan" ? "Lecture par Claude…" : "Ajout…"}
                  </span>
                )}
                <button onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))} title="Retirer" className="shrink-0 rounded-full p-1 text-ink-4 hover:text-bad">
                  <X size={14} />
                </button>
              </div>
              {d.error && (
                <p className="flex items-center gap-1 text-[11px] text-warn">
                  <AlertCircle size={11} /> {d.error}
                </p>
              )}
              {(d.state === "ready" || d.state === "saving") && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.3fr_0.8fr_1fr_1.3fr]">
                    <select
                      value={d.category}
                      onChange={(e) => patch(d.id, { category: e.target.value as ExpenseCategory })}
                      className={`${input} col-span-2 sm:col-span-1`}
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_META[c].label}
                        </option>
                      ))}
                    </select>
                    <input inputMode="decimal" value={d.amount} onChange={(e) => patch(d.id, { amount: e.target.value })} placeholder="Montant €" className={input} />
                    <input type="date" value={d.date} onChange={(e) => patch(d.id, { date: e.target.value })} className={input} />
                    <input
                      value={d.merchant}
                      onChange={(e) => patch(d.id, { merchant: e.target.value })}
                      placeholder="Fournisseur"
                      className={`${input} col-span-2 sm:col-span-1`}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <EventPicker draft={d} onChange={(event) => patch(d.id, { event, auto: false })} />
                    <button disabled={!valid(d)} onClick={() => save([d])} className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                      Ajouter
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
