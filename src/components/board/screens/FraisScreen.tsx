"use client";

import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, ShieldCheck, X, Search, ChevronRight, Download } from "lucide-react";
import {
  declareExpenses,
  getMyExpenses,
  getMyValidatorScope,
  getSubmissionsToReview,
  reviewSubmission,
  type MyExpenseItem,
  type SubmissionToReview,
} from "@/app/actions/expenses";
import { ExpenseLinesEditor, AttachmentLinks } from "@/components/board/expenses/ExpenseLinesEditor";
import { ExpenseImport } from "@/components/board/expenses/ExpenseImport";
import { ExpenseExportModal } from "@/components/board/expenses/ExpenseExportModal";
import { EventArrow } from "@/components/board/calendar/EventOpener";
import { lineParts } from "@/lib/board/expenseCategories";
import { ExpenseStatusBadge, EXPENSE_STATUS_META, confirmNoExpense, formatEuros } from "@/components/board/expenses/ExpenseStatus";
import { EVENT_TYPE_TO_ORG } from "@/lib/board/calendar";
import { ORG_COLORS, ORG_LABELS } from "@/lib/board/tokens";
import { OpenEventButton } from "@/components/board/calendar/OpenEventButton";

type Tab = "mine" | "validate";
type MineFilter = "a_declarer" | "upcoming" | "pending" | "approved" | "rejected" | "all";

const MINE_FILTERS: { id: MineFilter; label: string }[] = [
  { id: "a_declarer", label: "À déclarer" },
  { id: "upcoming", label: "À venir" },
  { id: "pending", label: "En attente" },
  { id: "approved", label: "Validés" },
  { id: "rejected", label: "Refusés" },
  { id: "all", label: "Tous" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Recherche + mois (+ personne) : barre de filtres commune à « Mes frais » et « À valider ». */
function FiltersRow({
  query,
  onQuery,
  months,
  month,
  onMonth,
  people,
  person,
  onPerson,
  children,
}: {
  query: string;
  onQuery: (v: string) => void;
  months: string[];
  month: string;
  onMonth: (v: string) => void;
  people?: { id: string; name: string }[];
  person?: string;
  onPerson?: (v: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-btn border border-line bg-card px-2.5 py-1.5">
        <Search size={13} className="text-ink-4" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Rechercher…" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <select value={month} onChange={(e) => onMonth(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none">
        <option value="">Tous les mois</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      {people && onPerson && (
        <select value={person} onChange={(e) => onPerson(e.target.value)} className="max-w-[200px] rounded-btn border border-line bg-card px-2 py-1.5 text-sm outline-none">
          <option value="">Toutes les personnes</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {children}
    </div>
  );
}

function GroupHeader({ label, total, count }: { label: string; total: number; count: number }) {
  return (
    <div className="flex items-center justify-between bg-subtle px-4 py-1.5 text-[11px] font-bold text-ink-3">
      <span>{label}</span>
      <span>
        {count} fiche{count > 1 ? "s" : ""} · {formatEuros(total)}
      </span>
    </div>
  );
}

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

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"
      }`}
    >
      {children}
    </button>
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

function MyExpenses() {
  const { user } = useAuth();
  // Dernière liste connue affichée tout de suite (navigateur), puis rafraîchie.
  const cacheKey = `frais:mine:${user?.id ?? ""}`;
  const [items, setItems] = useState<MyExpenseItem[] | null>(() => readCache<MyExpenseItem[]>(cacheKey) ?? null);
  const [filter, setFilter] = useState<MineFilter>("a_declarer");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
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
  }, [load]);
  useLiveRefresh(
    ["event_expenses", "expense_submissions", "notifications", "event_team_members", "event_assignments", "coverage_requests", "director_attendance", "photo_missions"],
    () => void load()
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items ?? []) {
      const k = i.upcoming ? "upcoming" : i.status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [items]);
  const months = useMemo(() => [...new Set((items ?? []).map((i) => monthKey(i.start)))].sort().reverse(), [items]);
  // Mois exportables : ceux où des frais ont été saisis.
  const exportMonths = useMemo(() => [...new Set((items ?? []).filter((i) => i.lineCount > 0).map((i) => monthKey(i.start)))].sort().reverse(), [items]);
  const q = normalize(query.trim());
  const visible = (items ?? []).filter(
    (i) => (filter === "all" || (filter === "upcoming" ? !!i.upcoming : !i.upcoming && i.status === filter)) && (!month || monthKey(i.start) === month) && (!q || normalize(i.title).includes(q))
  );
  // Regroupement par mois.
  const groups = new Map<string, MyExpenseItem[]>();
  for (const i of visible) groups.set(monthKey(i.start), [...(groups.get(monthKey(i.start)) ?? []), i]);

  if (!items) return <div className="p-6 text-sm text-ink-4">Chargement…</div>;

  return (
    <div className="space-y-3">
      <ExpenseImport onAdded={() => void load()} />
      <div className="flex flex-wrap gap-1.5">
        {MINE_FILTERS.map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id !== "all" && counts[f.id] ? ` (${counts[f.id]})` : f.id === "all" ? ` (${items.length})` : ""}
          </FilterChip>
        ))}
      </div>
      <FiltersRow query={query} onQuery={setQuery} months={months} month={month} onMonth={setMonth}>
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
          {filter === "a_declarer" && !q && !month ? "Rien à déclarer : tous vos frais sont à jour. 👍" : "Aucune note de frais ici."}
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
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
                >
                  <div className="min-w-0 flex-1">
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
                  <span className="shrink-0 text-sm font-bold text-ink">{i.total > 0 ? formatEuros(i.total) : ""}</span>
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
  );
}

/* ---------- À valider (N+1) ---------- */

/** Fiche de validation : détail des lignes, justificatifs, puis Valider / Refuser (motif obligatoire). */
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
                <span className="shrink-0 font-bold text-ink">{formatEuros(Number(l.total_amount ?? 0))}</span>
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
              placeholder="Commentaire (obligatoire en cas de refus)…"
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

/** Déclarations des personnes dont je suis le N+1 — uniquement elles. */
function ToValidate({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [subs, setSubs] = useState<SubmissionToReview[] | null>(null);
  const [open, setOpen] = useState<SubmissionToReview | null>(null);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [person, setPerson] = useState("");
  const [groupBy, setGroupBy] = useState<"person" | "month">("person");

  const load = useCallback(() => getSubmissionsToReview(status, "mine").then(setSubs).catch(() => setSubs([])), [status]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(["event_expenses", "expense_submissions", "notifications"], () => {
    void load();
    onChanged();
  });

  const months = useMemo(() => [...new Set((subs ?? []).map((s) => monthKey(s.event.start)))].sort().reverse(), [subs]);
  const people = useMemo(
    () => [...new Map((subs ?? []).map((s) => [s.person.id, { id: s.person.id, name: s.person.name }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    [subs]
  );
  const q = normalize(query.trim());
  const visible = (subs ?? []).filter(
    (s) =>
      (!month || monthKey(s.event.start) === month) &&
      (!person || s.person.id === person) &&
      (!q || normalize(`${s.person.name} ${s.event.title}`).includes(q))
  );
  const groups = new Map<string, { label: string; items: SubmissionToReview[] }>();
  for (const s of visible) {
    const key = groupBy === "person" ? s.person.id : monthKey(s.event.start);
    const label = groupBy === "person" ? s.person.name : monthLabel(key);
    const g = groups.get(key) ?? { label, items: [] };
    g.items.push(s);
    groups.set(key, g);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["pending", "approved", "rejected"] as const).map((st) => (
          <FilterChip key={st} active={status === st} onClick={() => setStatus(st)}>
            {EXPENSE_STATUS_META[st].label}
          </FilterChip>
        ))}
      </div>
      <FiltersRow query={query} onQuery={setQuery} months={months} month={month} onMonth={setMonth} people={people} person={person} onPerson={setPerson}>
        <div className="flex rounded-full bg-subtle p-0.5 text-xs font-semibold">
          {(["person", "month"] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)} className={`rounded-full px-3 py-1 ${groupBy === g ? "bg-navy text-white" : "text-ink-3"}`}>
              {g === "person" ? "Par personne" : "Par mois"}
            </button>
          ))}
        </div>
      </FiltersRow>

      {!subs ? (
        <div className="p-6 text-sm text-ink-4">Chargement…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
          {status === "pending" ? "Aucune note de frais de votre équipe en attente de validation." : "Aucune note de frais."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-card">
          {[...groups.entries()].map(([key, g]) => (
            <div key={key}>
              <GroupHeader label={g.label} count={g.items.length} total={g.items.reduce((n, s) => n + s.total, 0)} />
              {g.items.map((s) => (
                <button
                  key={s.submissionId}
                  onClick={() => setOpen(s)}
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{groupBy === "person" ? s.event.title : s.person.name}</span>
                      {s.event.id && <EventArrow eventId={s.event.id} className="h-6 w-6" />}
                    </div>
                    <div className="truncate text-[11px] text-ink-4">
                      {groupBy === "person" ? "" : `${s.event.title} · `}
                      {fmtDate(s.event.start)}
                      {s.submittedAt && ` · déclaré le ${new Date(s.submittedAt).toLocaleDateString("fr-FR")}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-ink">{formatEuros(s.total)}</span>
                  <ChevronRight size={16} className="shrink-0 text-ink-4" />
                </button>
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
    </div>
  );
}

/* ---------- Écran ---------- */

/**
 * Frais : « Mes frais » (événements où je suis sollicité → déclarer), « À valider » (si je suis N+1
 * de quelqu'un, ou admin). Le N+1 de chacun se règle dans Administration → Utilisateurs.
 */
export function FraisScreen() {
  const [tab, setTab] = useState<Tab>("mine");
  const [scope, setScope] = useState<Awaited<ReturnType<typeof getMyValidatorScope>> | null>(null);

  const loadScope = useCallback(() => getMyValidatorScope().then(setScope).catch(() => undefined), []);
  useEffect(() => {
    void loadScope();
  }, [loadScope]);

  const tabs: { id: Tab; label: string; icon: typeof Receipt; badge?: number; show: boolean }[] = [
    { id: "mine", label: "Mes frais", icon: Receipt, show: true },
    { id: "validate", label: "À valider", icon: ShieldCheck, badge: scope?.pending, show: !!scope?.isValidator },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-btn px-3.5 py-2 text-sm font-semibold ${
                  tab === t.id ? "bg-navy text-white" : "bg-card text-ink-2 hover:bg-hover"
                }`}
              >
                <Icon size={15} /> {t.label}
                {!!t.badge && <span className="rounded-full bg-red px-1.5 text-[10px] font-bold text-white">{t.badge}</span>}
              </button>
            );
          })}
      </div>

      {tab === "mine" && <MyExpenses />}
      {tab === "validate" && <ToValidate onChanged={() => void loadScope()} />}
    </div>
  );
}
