"use client";

import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Receipt, ShieldCheck, X, ChevronRight, Download, Settings, Check, Camera, Paperclip, FileText, Briefcase, Banknote } from "lucide-react";
import { useFraisFlavor } from "@/hooks/board/useFraisFlavor";
import { takeFraisTab, type FraisTab } from "@/lib/board/fraisTab";
import { FRAIS_FLAVORS } from "@/lib/board/fraisFlavor";
import { MyInvoices, Payables, PrestataireInvoices } from "@/components/board/invoices/InvoiceTabs";
import {
  declareExpenses,
  getMyExpenses,
  getMyValidatorScope,
  getSubmissionsToReview,
  reviewSubmission,
  type MyExpenseItem,
  type SubmissionToReview,
} from "@/app/actions/expenses";
import { ExpenseLinesEditor, AttachmentLinks, LineAmount } from "@/components/board/expenses/ExpenseLinesEditor";
import { ExpenseImport, type ExpenseImportHandle } from "@/components/board/expenses/ExpenseImport";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { RECEIPT_ACCEPT } from "@/lib/board/receiptUpload";
import { ExpenseExportModal } from "@/components/board/expenses/ExpenseExportModal";
import { ExpenseMailSettings } from "@/components/board/expenses/ExpenseMailSettings";
import { EventArrow } from "@/components/board/calendar/EventOpener";
import { lineParts } from "@/lib/board/expenseCategories";
import { ExpenseStatusBadge, EXPENSE_STATUS_META, confirmNoExpense, formatEuros } from "@/components/board/expenses/ExpenseStatus";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";
import { OpenEventButton } from "@/components/board/calendar/OpenEventButton";
import {
  FilterChip,
  FiltersRow,
  GroupHeader,
  MONTH_LONG,
  PeriodMenu,
  YearMonthBar,
  fmtDate,
  monthIndexOf,
  monthKey,
  monthLabel,
  normalize,
  yearOf,
  type MobileMenu,
  type Period,
} from "@/components/board/expenses/PeriodNav";

type Tab = FraisTab;

type MineFilter = "a_declarer" | "upcoming" | "pending" | "approved" | "rejected" | "all";

const MINE_FILTERS: { id: MineFilter; label: string }[] = [
  { id: "a_declarer", label: "À déclarer" },
  { id: "upcoming", label: "À venir" },
  { id: "pending", label: "En attente" },
  { id: "approved", label: "Validés" },
  { id: "rejected", label: "Refusés" },
  { id: "all", label: "Tous" },
];

function OrgChip({ eventType }: { eventType: MyExpenseItem["eventType"] }) {
  if (!eventType) return null;
  const org = EVENT_TYPE_TO_ORG[eventType];
  const c = ORG_COLORS[org];
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: c.bg, color: c.ink }}>
      {ORG_LABELS[org]}
    </span>
  );
}

/* ---------- Mes frais ---------- */

/** Fiche de frais (événement ou hors événement d'un mois) : lignes, justificatifs, déclaration au N+1. */
export function ExpenseSheetModal({ item, onClose, onChanged }: { item: MyExpenseItem; onClose: () => void; onChanged: () => void }) {
  const locked = item.status === "approved";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 bg-navy px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Note de frais</div>
              <h3 className="mt-1 truncate text-base font-extrabold">{item.title}</h3>
              <div className="mt-0.5 text-xs text-white/80">
                {item.eventId ? `${fmtDate(item.start)} · ${item.roles.join(", ") || "—"}` : "Dépenses sans événement, déclarées pour le mois"}
              </div>
              {item.eventId && (
                <OpenEventButton eventId={item.eventId} className="mt-2 flex items-center gap-1 text-xs font-semibold text-white/90 hover:underline" />
              )}
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <ExpenseLinesEditor target={item.eventId ? { eventId: item.eventId } : { month: item.month! }} locked={locked} onChanged={onChanged} />
        </div>
      </div>
    </div>
  );
}

function MyExpenses({ period, menu, reloadKey = 0 }: { period: Period; menu?: MobileMenu; reloadKey?: number }) {
  const { user } = useAuth();
  // Dernière liste connue affichée tout de suite (navigateur), puis rafraîchie.
  const cacheKey = `frais:mine:${user?.id ?? ""}`;
  const [items, setItems] = useState<MyExpenseItem[] | null>(() => readCache<MyExpenseItem[]>(cacheKey) ?? null);
  const [filter, setFilter] = useState<MineFilter>("a_declarer");
  const [query, setQuery] = useState("");
  const { year, monthIdx } = period;
  // Mobile : les événements à venir sont dans « À déclarer » (pas de filtre « À venir »).
  const mergeUpcoming = !!menu;
  const month = monthIdx === null ? "" : `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const [open, setOpen] = useState<MyExpenseItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getMyExpenses()
        .then((fresh) => {
          setItems(fresh);
          writeCache(cacheKey, fresh);
        })
        .catch(() => setItems((prev) => prev ?? [])),
    [cacheKey]
  );
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  useLiveRefresh(
    ["event_expenses", "expense_submissions", "notifications", "event_team_members", "event_assignments", "coverage_requests", "director_attendance", "photo_missions"],
    () => void load()
  );

  // Compteurs des filtres : sur la période choisie à gauche (le mois, ou toute l'année).
  const inPeriod = useMemo(
    () => (items ?? []).filter((i) => yearOf(i.start) === year && (monthIdx === null || monthIndexOf(i.start) === monthIdx)),
    [items, year, monthIdx]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of inPeriod) {
      const k = i.upcoming && !mergeUpcoming ? "upcoming" : i.status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [inPeriod, mergeUpcoming]);
  // Mois exportables : ceux où des frais ont été saisis.
  const exportMonths = useMemo(() => [...new Set((items ?? []).filter((i) => i.lineCount > 0).map((i) => monthKey(i.start)))].sort().reverse(), [items]);
  const q = normalize(query.trim());
  // Statut et recherche, puis l'année : base des compteurs de la barre des mois.
  const inYear = (items ?? []).filter(
    (i) => (filter === "all" || (filter === "upcoming" ? !!i.upcoming : (!i.upcoming || mergeUpcoming) && i.status === filter)) && (!q || normalize(i.title).includes(q)) && yearOf(i.start) === year
  );
  const visible = inYear.filter((i) => monthIdx === null || monthIndexOf(i.start) === monthIdx);
  const monthStats = (m: number | null) => {
    const list = m === null ? inYear : inYear.filter((i) => monthIndexOf(i.start) === m);
    return { count: list.length, total: list.reduce((n, i) => n + i.total, 0) };
  };
  // Regroupement par mois.
  const groups = new Map<string, MyExpenseItem[]>();
  for (const i of visible) groups.set(monthKey(i.start), [...(groups.get(monthKey(i.start)) ?? []), i]);

  if (!items) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  return (
    <div className="space-y-3 md:flex md:items-start md:gap-4 md:space-y-0">
      {menu ? (
        <PeriodMenu menu={menu} period={period} stats={monthStats} />
      ) : (
        <YearMonthBar year={year} onYear={period.setYear} month={monthIdx} onMonth={period.setMonthIdx} stats={monthStats} />
      )}
      <div className="min-w-0 flex-1 space-y-3">
      {!menu && <ExpenseImport onAdded={() => void load()} />}
      <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
        {MINE_FILTERS.filter((f) => !(mergeUpcoming && f.id === "upcoming")).map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== "all" && counts[f.id] ? ` (${counts[f.id]})` : f.id === "all" ? ` (${inPeriod.length})` : ""}
          </FilterChip>
        ))}
      </div>
      <FiltersRow query={query} onQuery={setQuery}>
        <button
          onClick={() => setExporting(true)}
          disabled={!exportMonths.length}
          title={exportMonths.length ? "Fiche individuelle du mois en PDF signé ou Excel" : "Aucun frais saisi à exporter"}
          className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
        >
          <Download size={14} /> Exporter
        </button>
      </FiltersRow>

      {visible.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
          {filter === "a_declarer" && !q
            ? month
              ? "Rien à déclarer ce mois-ci. 👍"
              : "Rien à déclarer : tous vos frais sont à jour. 👍"
            : "Aucune note de frais ici."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-card">
          {[...groups.entries()].map(([key, group]) => (
            <div key={key}>
              <GroupHeader label={monthLabel(key)} count={group.length} total={group.reduce((n, i) => n + i.total, 0)} />
              {group.map((i) => (
                <div
                  key={i.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(i);
                    }
                  }}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover md:flex-nowrap"
                >
                  <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{i.title}</span>
                      <OrgChip eventType={i.eventType} />
                      {i.eventId && <EventArrow eventId={i.eventId} className="h-6 w-6" />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-4">
                      {i.eventId ? `${fmtDate(i.start)} · ${i.roles.join(", ") || "Frais saisis"}` : "Hors événement"}
                      {i.lineCount > 0 && ` · ${i.lineCount} ligne${i.lineCount > 1 ? "s" : ""}`}
                    </div>
                    {i.status === "rejected" && i.reviewerComment && <div className="mt-0.5 truncate text-[11px] text-bad">Motif : {i.reviewerComment}</div>}
                  </div>
                  <span className="mr-auto shrink-0 text-sm font-bold text-ink md:mr-0">{i.total > 0 ? formatEuros(i.total) : ""}</span>
                  {i.status === "a_declarer" || i.status === "rejected" ? (
                    <>
                      {i.eventId && (i.status === "rejected" || i.lineCount === 0) && (
                        <button
                          disabled={busy === i.key}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirmNoExpense(i.lineCount)) return;
                            setBusy(i.key);
                            const res = await declareExpenses({ eventId: i.eventId! }, true);
                            setBusy(null);
                            if (res.error) return alert(res.error);
                            void load();
                          }}
                          className="shrink-0 rounded-btn border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
                        >
                          Pas de frais
                        </button>
                      )}
                      <span className="shrink-0 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white shadow-btn-red">
                        {i.status === "rejected" ? "Corriger" : "Déclarer"}
                      </span>
                    </>
                  ) : (
                    <ExpenseStatusBadge status={i.status} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {exporting && (
        <ExpenseExportModal
          months={exportMonths}
          initialMonth={exportMonths.includes(month) ? month : exportMonths[0]}
          onClose={() => setExporting(false)}
        />
      )}

      {open && (
        <ExpenseSheetModal
          item={open}
          onClose={() => {
            setOpen(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      )}
      </div>
    </div>
  );
}

/* ---------- À valider (N+1) ---------- */

/** Fiche de validation : détail des lignes, justificatifs, puis Valider / Refuser (commentaire facultatif). */
export function ReviewModal({ sub, onClose, onDone }: { sub: SubmissionToReview; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDecide = sub.status === "pending";

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    const res = await reviewSubmission(sub.submissionId, decision, comment);
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 bg-navy px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Validation des frais</div>
              <h3 className="mt-1 truncate text-base font-extrabold">{sub.person.name}</h3>
              <div className="mt-0.5 truncate text-xs text-white/80">
                {sub.event.title} · {fmtDate(sub.event.start)}
              </div>
              {sub.event.id && (
                <OpenEventButton eventId={sub.event.id} className="mt-2 flex items-center gap-1 text-xs font-semibold text-white/90 hover:underline" />
              )}
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <ExpenseStatusBadge status={sub.status} />
            <span className="text-xl font-extrabold text-ink">{formatEuros(sub.total)}</span>
          </div>

          {sub.lines.map((l) => (
            <div key={l.id} className="rounded-btn border border-line p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-ink">
                    {lineParts(l)
                      .map((p) => p.label.replace(/ \(.*\)$/, ""))
                      .join(" + ") || "Frais"}
                    {l.merchant_name && <span className="font-normal text-ink-3"> · {l.merchant_name}</span>}
                  </div>
                  <div className="text-[11px] text-ink-4">
                    {new Date(`${(l.expense_date ?? l.created_at).slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR")}
                    {(l.description || l.other_fees_description) && ` · ${l.description || l.other_fees_description}`}
                    {l.distance_km ? ` · ${l.distance_km} km` : ""}
                  </div>
                </div>
                <LineAmount line={l} />
              </div>
              {lineParts(l).length > 1 && (
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2">
                  {lineParts(l).map((p) => (
                    <span key={p.category}>
                      {p.label} : <strong>{formatEuros(p.amount)}</strong>
                    </span>
                  ))}
                </div>
              )}
              {l.attachments.length > 0 ? (
                <AttachmentLinks attachments={l.attachments} />
              ) : (
                <p className="mt-1 text-[11px] italic text-ink-4">Sans justificatif</p>
              )}
            </div>
          ))}

          {sub.reviewerComment && !canDecide && <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-2">Commentaire : {sub.reviewerComment}</p>}

          {canDecide && (
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Commentaire (facultatif)…"
              className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none"
            />
          )}
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>

        {canDecide && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
            <button
              disabled={busy}
              onClick={() => decide("rejected")}
              className="rounded-btn border border-bad px-4 py-2 text-sm font-bold text-bad disabled:opacity-50"
            >
              Refuser
            </button>
            <button
              disabled={busy}
              onClick={() => decide("approved")}
              className="rounded-btn bg-good px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Valider"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Refus depuis la liste : commentaire facultatif, envoyé au déclarant. */
function RejectModal({ sub, onClose, onDone }: { sub: SubmissionToReview; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reject = async () => {
    setBusy(true);
    setError(null);
    const res = await reviewSubmission(sub.submissionId, "rejected", comment);
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-ink">Refuser les frais</h3>
            <div className="mt-0.5 truncate text-xs text-ink-3">
              {sub.person.name} · {sub.event.title} · {formatEuros(sub.total)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-4 hover:bg-hover">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2 p-5">
          <label className="block text-xs font-semibold text-ink-3" htmlFor="reject-comment">
            Commentaire (facultatif, envoyé à {sub.person.name.split(" ")[0]})
          </label>
          <textarea
            id="reject-comment"
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="ex. Justificatif du péage manquant…"
            className="w-full rounded-btn border border-line px-3 py-2 text-sm outline-none focus:border-link"
          />
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} className="rounded-btn border border-line px-4 py-2 text-sm font-semibold text-ink-2 hover:bg-hover">
            Annuler
          </button>
          <button disabled={busy} onClick={reject} className="rounded-btn bg-bad px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "…" : "Refuser"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Déclarations des personnes dont je suis le N+1 (`scope` « mine »), ou de tout le monde (GED, « all »). */
function ToValidate({ onChanged, period, menu, scope = "mine" }: { onChanged: () => void; period: Period; menu?: MobileMenu; scope?: "mine" | "all" }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [subs, setSubs] = useState<SubmissionToReview[] | null>(null);
  const [open, setOpen] = useState<SubmissionToReview | null>(null);
  const [rejecting, setRejecting] = useState<SubmissionToReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { year, monthIdx } = period;

  const load = useCallback(() => getSubmissionsToReview(status, scope).then(setSubs).catch(() => setSubs([])), [status, scope]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(["event_expenses", "expense_submissions", "notifications"], () => {
    void load();
    onChanged();
  });

  const approve = async (s: SubmissionToReview) => {
    setBusy(s.submissionId);
    const res = await reviewSubmission(s.submissionId, "approved", "");
    setBusy(null);
    if (res.error) return alert(res.error);
    void load();
    onChanged();
  };

  const q = normalize(query.trim());
  // Année → mois → utilisateurs.
  const inYear = (subs ?? []).filter((s) => yearOf(s.event.start) === year && (!q || normalize(`${s.person.name} ${s.event.title}`).includes(q)));
  const visible = inYear.filter((s) => monthIdx === null || monthIndexOf(s.event.start) === monthIdx);
  const monthStats = (m: number | null) => {
    const list = m === null ? inYear : inYear.filter((s) => monthIndexOf(s.event.start) === m);
    return { count: list.length, total: list.reduce((n, s) => n + s.total, 0) };
  };
  const groups = new Map<string, { label: string; items: SubmissionToReview[] }>();
  for (const s of [...visible].sort((a, b) => a.person.name.localeCompare(b.person.name) || a.event.start.localeCompare(b.event.start))) {
    const g = groups.get(s.person.id) ?? { label: s.person.name, items: [] };
    g.items.push(s);
    groups.set(s.person.id, g);
  }

  return (
    <div className="space-y-3 md:flex md:items-start md:gap-4 md:space-y-0">
      {menu ? (
        <PeriodMenu menu={menu} period={period} stats={monthStats} />
      ) : (
        <YearMonthBar year={year} onYear={period.setYear} month={monthIdx} onMonth={period.setMonthIdx} stats={monthStats} />
      )}
      <div className="min-w-0 flex-1 space-y-3">
      <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
        {(["pending", "approved", "rejected"] as const).map((st) => (
          <FilterChip key={st} active={status === st} onClick={() => setStatus(st)}>
            {EXPENSE_STATUS_META[st].label}
          </FilterChip>
        ))}
      </div>
      <FiltersRow query={query} onQuery={setQuery} />

      {!subs ? (
        <div className="p-6 text-sm text-ink-4">Chargement…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
          {status === "pending" ? (scope === "all" ? "Aucune note de frais en attente de validation." : "Aucune note de frais de votre équipe en attente de validation.") : "Aucune note de frais."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-card">
          {[...groups.entries()].map(([key, g]) => (
            <div key={key}>
              <GroupHeader label={g.label} count={g.items.length} total={g.items.reduce((n, s) => n + s.total, 0)} />
              {g.items.map((s) => (
                <div
                  key={s.submissionId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(s)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setOpen(s);
                    }
                  }}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover md:flex-nowrap"
                >
                  <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{s.event.title}</span>
                      {s.event.id && <EventArrow eventId={s.event.id} className="h-6 w-6" />}
                    </div>
                    <div className="truncate text-[11px] text-ink-4">
                      {fmtDate(s.event.start)}
                      {s.submittedAt && ` · déclaré le ${new Date(s.submittedAt).toLocaleDateString("fr-FR")}`}
                    </div>
                  </div>
                  <span className="mr-auto shrink-0 text-sm font-bold text-ink md:mr-0">{formatEuros(s.total)}</span>
                  {s.status === "pending" ? (
                    <>
                      <button
                        disabled={busy === s.submissionId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRejecting(s);
                        }}
                        className="shrink-0 rounded-btn border border-bad px-3 py-1.5 text-xs font-bold text-bad hover:bg-bad/5 disabled:opacity-50"
                      >
                        Refuser
                      </button>
                      <button
                        disabled={busy === s.submissionId}
                        onClick={(e) => {
                          e.stopPropagation();
                          void approve(s);
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-btn bg-good px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        <Check size={13} /> {busy === s.submissionId ? "…" : "Valider"}
                      </button>
                    </>
                  ) : (
                    <ChevronRight size={16} className="shrink-0 text-ink-4" />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {open && (
        <ReviewModal
          sub={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void load();
            onChanged();
          }}
        />
      )}

      {rejecting && (
        <RejectModal
          sub={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            void load();
            onChanged();
          }}
        />
      )}
      </div>
    </div>
  );
}

/* ---------- Écran ---------- */

const headerBtn = "flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10";

type TabDef = { id: Tab; label: string; icon: typeof Receipt; badge?: number; badgeTone?: "red" | "orange"; show: boolean; hint: string };

/** Choix « Tout le monde » / « Mon équipe » (compta qui est aussi N+1). */
function WhoSwitch({ value, onChange, teamLabel }: { value: "all" | "mine"; onChange: (v: "all" | "mine") => void; teamLabel: string }) {
  return (
    <div className="flex shrink-0 rounded-btn border border-line bg-card p-0.5 text-xs font-semibold">
      {(["all", "mine"] as const).map((v) => (
        <button key={v} onClick={() => onChange(v)} className={`rounded-[6px] px-2.5 py-1 ${value === v ? "bg-navy text-white" : "text-ink-3 hover:bg-hover"}`}>
          {v === "all" ? "Tout le monde" : teamLabel}
        </button>
      ))}
    </div>
  );
}

/**
 * Module Frais, nommé selon le profil (fraisFlavor.ts), en trois temps :
 * - Moi : « Mes factures » (prestataires : une facture par intervention) et « Mes frais » ;
 * - À valider : « Notes de frais » (mon équipe en tant que N+1 ; tout le monde pour la GED) et
 *   « Factures » des prestataires (les miens ; tous pour la GED) ;
 * - Compta (GED : administrateurs et compta) : « Paiements », factures et notes de frais validées à
 *   marquer payées.
 * Chaque onglet dit en une phrase à quoi il sert ; les pastilles comptent ce qui attend, comme le
 * tableau de bord. Le N+1 de chacun se règle dans Administration → Utilisateurs.
 * `mobile` (appli mobile) : en-tête propre — retour, période dans le menu du titre, Photo / Joindre
 * et Paramètres en haut —, mois en cours par défaut et événements à venir dans « À déclarer ».
 */
export function FraisScreen({ mobile }: { mobile?: { onBack: () => void } } = {}) {
  const flavor = useFraisFlavor();
  const homeTab = (f: typeof flavor): Tab => (f === "factures" ? "invoices" : f === "ged" ? "frais" : "mine");
  const [tab, setTab] = useState<Tab>(() => takeFraisTab() ?? homeTab(flavor));
  const [who, setWho] = useState<"all" | "mine">("all");
  const [scope, setScope] = useState<Awaited<ReturnType<typeof getMyValidatorScope>> | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [monthIdx, setMonthIdx] = useState<number | null>(() => (mobile ? new Date().getMonth() : null));
  const period: Period = { year, monthIdx, setYear, setMonthIdx };
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const menu: MobileMenu | undefined = mobile ? { host: menuHost, open: menuOpen, onClose: () => setMenuOpen(false) } : undefined;
  const [reloadKey, setReloadKey] = useState(0);
  const importRef = useRef<ExpenseImportHandle>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadScope = useCallback(() => getMyValidatorScope().then(setScope).catch(() => undefined), []);
  useEffect(() => {
    void loadScope();
  }, [loadScope]);
  useLiveRefresh(["expense_submissions", "notifications"], () => void loadScope());
  // Profil connu après coup (tout premier chargement) : chacun arrive sur son onglet principal.
  const [flavorSeen, setFlavorSeen] = useState(flavor);
  if (flavorSeen !== flavor) {
    setFlavorSeen(flavor);
    setTab(homeTab(flavor));
  }

  const isGed = flavor === "ged" || !!scope?.seesAll;
  const prestataire = flavor === "factures";
  const groups: { label: string; tabs: TabDef[] }[] = [
    {
      label: "Moi",
      tabs: [
        {
          id: "invoices",
          label: "Mes factures",
          icon: FileText,
          show: prestataire,
          hint: "Déposez la facture de chaque intervention passée : elle part en validation chez votre responsable, puis en paiement.",
        },
        {
          id: "mine",
          label: "Mes frais",
          icon: Receipt,
          show: true,
          hint: prestataire
            ? "Frais exceptionnels non compris dans vos factures (péage, hôtel…) : saisissez-les avec le justificatif, puis déclarez-les."
            : "Vos dépenses par événement (ou hors événement, au mois) : saisissez-les avec les justificatifs, puis déclarez-les à votre N+1.",
        },
      ],
    },
    {
      label: "À valider",
      tabs: [
        {
          id: "frais",
          label: "Notes de frais",
          icon: ShieldCheck,
          badge: isGed ? scope?.pendingAll : scope?.pending,
          show: isGed || !!scope?.isValidator,
          hint: isGed
            ? "Notes de frais déclarées : validez-les ou refusez-les. Validées, elles passent dans Paiements."
            : "Notes de frais de votre équipe : validez-les ou refusez-les. Validées, la compta les rembourse.",
        },
        {
          id: "factures",
          label: "Factures",
          icon: Briefcase,
          badge: isGed ? scope?.pendingInvoicesAll : scope?.pendingInvoices,
          show: isGed || !!scope?.hasPrestataireReports,
          hint: "Factures des prestataires, intervention par intervention : à valider, manquantes (intervention passée sans facture), validées ou refusées.",
        },
      ],
    },
    {
      label: "Compta",
      tabs: [
        {
          id: "payables",
          label: "Paiements",
          icon: Banknote,
          badge: scope?.unpaid,
          badgeTone: "orange",
          show: isGed,
          hint: "Tout ce qui est validé : marquez les factures payées et les notes de frais remboursées.",
        },
      ],
    },
  ];
  // Mobile : Paramètres est la roue crantée de l'en-tête.
  const settingsTab: TabDef = { id: "settings", label: "Paramètres", icon: Settings, show: !mobile, hint: "Réglages du module : import des justificatifs par e-mail…" };
  const shownGroups = groups.map((g) => ({ ...g, tabs: g.tabs.filter((t) => t.show) })).filter((g) => g.tabs.length);
  const allTabs = [...shownGroups.flatMap((g) => g.tabs), settingsTab];
  const current = allTabs.find((t) => t.id === tab);
  // Onglet plus disponible (profil, droits) : retour à l'onglet principal.
  if (scope && !current && tab !== "settings") setTab(homeTab(flavor));
  const showWho = (tab === "frais" && isGed && !!scope?.isValidator) || (tab === "factures" && isGed && !!scope?.hasPrestataireReports);
  // GED : tout le monde, sauf si elle choisit son équipe / ses prestataires ; sinon les miens.
  const listScope: "all" | "mine" = isGed && !(showWho && who === "mine") ? "all" : "mine";

  const tabButton = (t: TabDef) => {
    const Icon = t.icon;
    return (
      <button
        key={t.id}
        onClick={() => setTab(t.id)}
        className={`flex shrink-0 items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"}`}
      >
        <Icon size={15} /> {t.label}
        {!!t.badge && <span className={`rounded-full px-1.5 text-[10px] font-bold text-white ${t.badgeTone === "orange" ? "bg-warn" : "bg-red"}`}>{t.badge}</span>}
      </button>
    );
  };

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    setTab("mine");
    importRef.current?.addFiles(files);
  };

  const body = (
    <div className="mx-auto max-w-6xl space-y-3 p-3 md:space-y-4 md:p-4">
      {allTabs.filter((t) => t.show).length > 1 && (
        <div className="-mx-3 flex items-end gap-3 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {shownGroups.map((g, gi) => (
            <div key={g.label} className="flex shrink-0 items-end gap-3">
              {gi > 0 && <span className="mb-1 h-7 w-px bg-line" aria-hidden />}
              <div>
                {shownGroups.length > 1 && <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">{g.label}</div>}
                <div className="flex gap-1.5">{g.tabs.map(tabButton)}</div>
              </div>
            </div>
          ))}
          {settingsTab.show && <div className="ml-auto shrink-0">{tabButton(settingsTab)}</div>}
        </div>
      )}
      {current && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs text-ink-3 md:text-sm">{current.hint}</p>
          {showWho && <WhoSwitch value={who} onChange={setWho} teamLabel={tab === "factures" ? "Mes prestataires" : "Mon équipe"} />}
        </div>
      )}

      {/* Mobile : justificatifs pris par les boutons de l'en-tête, à vérifier avant ajout (reste monté d'un onglet à l'autre). */}
      {mobile && <ExpenseImport ref={importRef} hideDropzone onAdded={() => setReloadKey((k) => k + 1)} />}

      {tab === "invoices" && <MyInvoices period={period} menu={menu} />}
      {tab === "mine" && <MyExpenses period={period} menu={menu} reloadKey={reloadKey} />}
      {tab === "frais" && <ToValidate key={listScope} scope={listScope} onChanged={() => void loadScope()} period={period} menu={menu} />}
      {tab === "factures" && <PrestataireInvoices key={listScope} scope={listScope} period={period} menu={menu} onChanged={() => void loadScope()} />}
      {tab === "payables" && <Payables period={period} menu={menu} />}
      {tab === "settings" && <ExpenseMailSettings />}
    </div>
  );

  if (!mobile) return body;

  const periodLabel = monthIdx === null ? `Année ${year}` : `${MONTH_LONG[monthIdx]} ${year}`;
  return (
    <div className="flex h-full flex-col">
      <MobileHeader
        title={FRAIS_FLAVORS[flavor].label}
        kicker={tab === "settings" ? "Paramètres" : periodLabel}
        onBack={mobile.onBack}
        onLogoClick={() => {
          if (tab === "settings") setTab(homeTab(flavor));
          setMenuOpen((o) => !o);
        }}
        menuOpen={menuOpen}
        onSettings={() => {
          setMenuOpen(false);
          setTab((t) => (t === "settings" ? homeTab(flavor) : "settings"));
        }}
        app="frais"
        actions={
          <>
            <button type="button" onClick={() => cameraRef.current?.click()} className={headerBtn} aria-label="Photo d'un justificatif">
              <Camera size={17} />
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className={headerBtn} aria-label="Joindre un justificatif">
              <Paperclip size={17} />
            </button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFiles} />
            <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} multiple hidden onChange={pickFiles} />
          </>
        }
      />
      <div ref={setMenuHost} className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto pb-6">{body}</div>
      </div>
    </div>
  );
}
