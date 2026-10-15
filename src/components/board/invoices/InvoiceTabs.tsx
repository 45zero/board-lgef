"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { EventArrow } from "@/components/board/calendar/EventOpener";
import { Building2, Check, Loader2, Plus, RotateCcw } from "lucide-react";
import { confirmMyInvoiceUpload, getMyInvoiceItems, getPayables, getStaffOverview, getStandaloneInvoices, prepareMyInvoiceUpload, setPaid } from "@/app/actions/staff";
import type { InvoiceRequestItem } from "@/app/actions/invoice-public";
import { InvoiceItemCard, stateOf, type InvoiceItemState } from "@/components/invoice/InvoiceUploadCard";
import { InvoiceLine } from "@/components/board/invoices/InvoiceLine";
import { CompanyModal, StandaloneInvoiceModal } from "@/components/board/invoices/InvoiceForms";
import { INVOICE_STATUS_LABELS, euros, invoiceMissing, standaloneAsEngagement, type Engagement, type Payable, type StaffOverview, type StandaloneInvoice } from "@/lib/board/staff";
import {
  FilterChip,
  FiltersRow,
  GroupHeader,
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

// Factures des prestataires dans le module Frais : « Mes factures » (le prestataire dépose la facture
// de chacune de ses interventions) et « Prestataires » (N+1 : ses prestataires ; GED : tous), par mois ;
// « À payer » (GED) : factures et notes de frais validées, à marquer payées.

const LIVE = ["event_team_members", "event_assignments", "coverage_requests", "photo_missions", "notifications"] as const;

/* ---------- Mes factures (prestataire) ---------- */

type MineFilter = "todo" | "pending" | "approved" | "all";
const MINE_FILTERS: { id: MineFilter; label: string }[] = [
  { id: "todo", label: "À déposer" },
  { id: "pending", label: "En validation" },
  { id: "approved", label: "Validées" },
  { id: "all", label: "Toutes" },
];
const isPast = (iso: string) => new Date(iso).getTime() < Date.now();
const mineBucket = (st: InvoiceItemState): MineFilter => (st === "todo" || st === "rejected" ? "todo" : st === "approved" ? "approved" : "pending");
const itemAmount = (i: InvoiceRequestItem) => i.existing?.amountTtc ?? i.expectedAmount ?? 0;

export function MyInvoices({ period, menu }: { period: Period; menu?: MobileMenu }) {
  const { user } = useAuth();
  const { year, monthIdx } = period;
  const cacheKey = `frais:invoices:${user?.id ?? ""}:${year}`;
  const [items, setItems] = useState<InvoiceRequestItem[] | null>(() => readCache<InvoiceRequestItem[]>(cacheKey) ?? null);
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<MineFilter>("todo");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState<StandaloneInvoice[]>([]);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        getMyInvoiceItems(year).then((res) => {
          if (!res.ok) return setError(res.error);
          setError(null);
          setItems(res.data);
          writeCache(cacheKey, res.data);
        }),
        getStandaloneInvoices(year, "me").then((res) => res.ok && setOthers(res.data)),
      ]),
    [year, cacheKey]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh([...LIVE], () => void load());

  const stateFor = useCallback((i: InvoiceRequestItem): InvoiceItemState => (sent.has(i.eventId) ? "sent" : stateOf(i)), [sent]);
  // « À déposer » : interventions passées sans facture (ou refusée) ; les suivantes restent dans « Toutes ».
  const bucketOf = (i: InvoiceRequestItem): MineFilter | null => {
    const b = mineBucket(stateFor(i));
    return b === "todo" && !isPast(i.eventStart) ? null : b;
  };
  const matches = (i: InvoiceRequestItem) => filter === "all" || bucketOf(i) === filter;
  const q = normalize(query.trim());
  const inYear = (items ?? []).filter((i) => yearOf(i.eventStart) === year && (!q || normalize(i.eventTitle).includes(q)));
  const inPeriod = inYear.filter((i) => monthIdx === null || monthIndexOf(i.eventStart) === monthIdx);
  const counts: Record<string, number> = {};
  for (const i of inPeriod) {
    const b = bucketOf(i);
    if (b) counts[b] = (counts[b] ?? 0) + 1;
  }
  const visible = inPeriod.filter(matches);
  const monthStats = (m: number | null) => {
    const list = inYear.filter((i) => matches(i) && (m === null || monthIndexOf(i.eventStart) === m));
    return { count: list.length, total: list.reduce((n, i) => n + itemAmount(i), 0) };
  };
  const groups = new Map<string, InvoiceRequestItem[]>();
  for (const i of visible) groups.set(monthKey(i.eventStart), [...(groups.get(monthKey(i.eventStart)) ?? []), i]);

  return (
    <div className="space-y-3 md:flex md:items-start md:gap-4 md:space-y-0">
      {menu ? <PeriodMenu menu={menu} period={period} stats={monthStats} /> : <YearMonthBar year={year} onYear={period.setYear} month={monthIdx} onMonth={period.setMonthIdx} stats={monthStats} />}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-1.5 text-sm font-bold text-white shadow-btn-red">
            <Plus size={14} /> Facture hors intervention
          </button>
          <button onClick={() => setCompany(true)} className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-hover">
            <Building2 size={14} /> Ma société
          </button>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {MINE_FILTERS.map((f) => (
            <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === "all" ? ` (${inPeriod.length})` : counts[f.id] ? ` (${counts[f.id]})` : ""}
            </FilterChip>
          ))}
        </div>
        <FiltersRow query={query} onQuery={setQuery} />
        {error && <p className="text-xs text-bad">{error}</p>}
        {!items ? (
          <div className="p-6 text-sm text-ink-4">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
            {filter === "todo" && !q ? "Aucune facture à déposer. 👍" : "Aucune intervention ici."}
          </div>
        ) : (
          [...groups.entries()].map(([key, group]) => (
            <div key={key} className="space-y-2">
              <div className="overflow-hidden rounded-panel border border-line">
                <GroupHeader label={monthLabel(key)} count={group.length} total={group.reduce((n, i) => n + itemAmount(i), 0)} />
              </div>
              {group.map((i) => (
                <InvoiceItemCard
                  key={i.eventId}
                  item={i}
                  state={stateFor(i)}
                  upload={{
                    prepare: (f) => prepareMyInvoiceUpload(i.eventId, f.name, f.type, f.size),
                    confirm: (path, amount, comment) => confirmMyInvoiceUpload(i.eventId, path, amount, comment),
                  }}
                  onSent={() => {
                    setSent((s) => new Set(s).add(i.eventId));
                    void load();
                  }}
                />
              ))}
            </div>
          ))
        )}
        <OtherInvoices list={others.filter((o) => (monthIdx === null || monthIndexOf(o.date) === monthIdx) && (filter === "all" || mineBucket(o.invoice.status === "approved" ? "approved" : o.invoice.status === "rejected" ? "rejected" : "pending") === filter))} />
        {adding && (
          <StandaloneInvoiceModal
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void load();
            }}
          />
        )}
        {company && <CompanyModal userId={null} name="Ma société" onClose={() => setCompany(false)} />}
      </div>
    </div>
  );
}

/** Mes factures sans intervention de la période : objet, n°, date, montant et statut. */
function OtherInvoices({ list }: { list: StandaloneInvoice[] }) {
  if (!list.length) return null;
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-card">
      <GroupHeader label="Hors intervention" count={list.length} total={list.reduce((n, o) => n + o.amountTtc, 0)} />
      {list.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-ink">{o.label}</div>
            <div className="text-[11px] text-ink-4">
              {fmtDate(`${o.date}T12:00:00`)}
              {o.invoiceNumber && ` · n° ${o.invoiceNumber}`}
            </div>
            {o.invoice.status === "rejected" && o.invoice.comment && <div className="text-[11px] text-bad">Motif du refus : {o.invoice.comment}</div>}
          </div>
          <span className="text-sm font-bold text-ink">{euros(o.amountTtc)}</span>
          <span className="rounded-chip bg-subtle px-1.5 py-0.5 text-[10px] font-bold text-ink-3">{INVOICE_STATUS_LABELS[o.invoice.status ?? ""] ?? "—"}</span>
          {o.invoice.paidAt && <span className="rounded-chip bg-good-bg px-1.5 py-0.5 text-[10px] font-bold text-good">Payée le {new Date(o.invoice.paidAt).toLocaleDateString("fr-FR")}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Prestataires (N+1, GED) ---------- */

type ReviewFilter = "pending" | "missing" | "approved" | "rejected" | "all";
const REVIEW_FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: "pending", label: "À valider" },
  { id: "missing", label: "Manquantes" },
  { id: "approved", label: "Validées" },
  { id: "rejected", label: "Refusées" },
  { id: "all", label: "Toutes" },
];
const PRESTATAIRE = "tech-prestataire";
const lineAmount = (e: Engagement) => e.invoice?.amountTtc ?? e.amount;

/**
 * Interventions des prestataires et leur facture, par mois puis par prestataire : `scope` « mine »
 * (mes prestataires, onglet À valider) ou « all » (GED, administrateurs).
 */
export function PrestataireInvoices({ scope, period, menu, onChanged }: { scope: "mine" | "all"; period: Period; menu?: MobileMenu; onChanged?: () => void }) {
  const { user } = useAuth();
  const { year, monthIdx } = period;
  const cacheKey = `frais:prestataires:${user?.id ?? ""}:${scope}:${year}`;
  const [data, setData] = useState<StaffOverview | null>(() => readCache<StaffOverview>(cacheKey) ?? null);
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<StandaloneInvoice[]>([]);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        getStaffOverview(year, scope).then((res) => {
          if (!res.ok) return setError(res.error);
          setError(null);
          setData(res.data);
          writeCache(cacheKey, res.data);
        }),
        getStandaloneInvoices(year, scope).then((res) => res.ok && setOthers(res.data)),
      ]),
    [year, scope, cacheKey]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh([...LIVE], () => void load());

  // Prestataires (statut), plus quiconque a une facture hors intervention.
  const people = useMemo(() => {
    const m = new Map((data?.people ?? []).filter((p) => p.status === PRESTATAIRE).map((p) => [p.id, { id: p.id, name: p.name }]));
    for (const o of others) if (!m.has(o.userId)) m.set(o.userId, { id: o.userId, name: o.personName });
    return m;
  }, [data, others]);
  const bucketOf = (e: Engagement): ReviewFilter | null =>
    e.invoice ? (e.invoice.status === "approved" ? "approved" : e.invoice.status === "rejected" ? "rejected" : "pending") : invoiceMissing(e, PRESTATAIRE) ? "missing" : null;
  const q = normalize(query.trim());
  const inYear = [...(data?.engagements ?? []), ...others.map(standaloneAsEngagement)].filter(
    (e) => e.confirmed && people.has(e.userId) && yearOf(e.start) === year && (!q || normalize(`${people.get(e.userId)!.name} ${e.title}`).includes(q))
  );
  const inPeriod = inYear.filter((e) => monthIdx === null || monthIndexOf(e.start) === monthIdx);
  const counts: Record<string, number> = {};
  for (const e of inPeriod) {
    const b = bucketOf(e);
    if (b) counts[b] = (counts[b] ?? 0) + 1;
  }
  const matches = (e: Engagement) => filter === "all" || bucketOf(e) === filter;
  const visible = inPeriod.filter(matches);
  const monthStats = (m: number | null) => {
    const list = inYear.filter((e) => matches(e) && (m === null || monthIndexOf(e.start) === m));
    return { count: list.length, total: list.reduce((n, e) => n + lineAmount(e), 0) };
  };
  const groups = new Map<string, Engagement[]>();
  for (const e of [...visible].sort((a, b) => people.get(a.userId)!.name.localeCompare(people.get(b.userId)!.name) || a.start.localeCompare(b.start))) {
    groups.set(e.userId, [...(groups.get(e.userId) ?? []), e]);
  }
  const changed = async () => {
    await load();
    onChanged?.();
  };

  return (
    <div className="space-y-3 md:flex md:items-start md:gap-4 md:space-y-0">
      {menu ? <PeriodMenu menu={menu} period={period} stats={monthStats} /> : <YearMonthBar year={year} onYear={period.setYear} month={monthIdx} onMonth={period.setMonthIdx} stats={monthStats} />}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setAdding(true)}
            disabled={!people.size}
            className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-1.5 text-sm font-bold text-white shadow-btn-red disabled:opacity-50"
          >
            <Plus size={14} /> Facture hors intervention
          </button>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {REVIEW_FILTERS.map((f) => (
            <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === "all" ? ` (${inPeriod.length})` : counts[f.id] ? ` (${counts[f.id]})` : ""}
            </FilterChip>
          ))}
        </div>
        <FiltersRow query={query} onQuery={setQuery} />
        {error && <p className="text-xs text-bad">{error}</p>}
        {!data ? (
          <div className="p-6 text-sm text-ink-4">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">
            {filter === "pending" && !q ? "Aucune facture de prestataire en attente de validation." : "Aucune facture ici."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-panel border border-line bg-card">
            {[...groups.entries()].map(([personId, list]) => {
              const person = people.get(personId)!;
              return (
                <div key={personId}>
                  <div className="flex items-center gap-2 bg-subtle pr-2">
                    <div className="min-w-0 flex-1">
                      <GroupHeader label={person.name} count={list.length} total={list.reduce((n, e) => n + lineAmount(e), 0)} />
                    </div>
                    <button
                      onClick={() => setCompany(person)}
                      title="Fiche société : raison sociale, SIRET, IBAN, domaines e-mail"
                      className="flex items-center gap-1 rounded-btn px-2 py-0.5 text-[11px] font-semibold text-link hover:bg-hover"
                    >
                      <Building2 size={12} /> Société
                    </button>
                  </div>
                  {list.map((e) => (
                    <div key={`${e.userId}|${e.eventId || e.invoice?.id}`} className="border-b border-line px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-ink">{e.title}</span>
                            {e.eventId && <EventArrow eventId={e.eventId} className="h-6 w-6" />}
                          </div>
                          <div className="text-[11px] text-ink-4">
                            {fmtDate(e.start)} · {e.eventId ? e.roles.join(", ") : `Hors intervention${e.note ? ` · ${e.note}` : ""}`}
                          </div>
                        </div>
                        {e.amount > 0 && e.eventId && <span className="shrink-0 text-xs text-ink-3">Prévu : {euros(e.amount)}</span>}
                      </div>
                      <InvoiceLine
                        engagement={e}
                        status={PRESTATAIRE}
                        claimedTo={claimed[`${e.userId}|${e.eventId}`] ?? null}
                        onClaimed={(email) => setClaimed((c) => ({ ...c, [`${e.userId}|${e.eventId}`]: email }))}
                        onChanged={changed}
                        onError={setError}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {adding && (
          <StandaloneInvoiceModal
            people={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))}
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void changed();
            }}
          />
        )}
        {company && <CompanyModal userId={company.id} name={company.name} onClose={() => setCompany(null)} />}
      </div>
    </div>
  );
}

/* ---------- À payer (GED) ---------- */

type PayFilter = "unpaid" | "paid" | "all";
type PayKind = "all" | "invoice" | "expense";
const PAY_FILTERS: { id: PayFilter; label: string }[] = [
  { id: "unpaid", label: "À payer" },
  { id: "paid", label: "Payés" },
  { id: "all", label: "Tous" },
];
const PAY_KINDS: { id: PayKind; label: string }[] = [
  { id: "all", label: "Factures et frais" },
  { id: "invoice", label: "Factures prestataires" },
  { id: "expense", label: "Notes de frais" },
];
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Compta : ce qui est validé, à payer (factures) ou à rembourser (notes de frais), par mois. */
export function Payables({ period, menu }: { period: Period; menu?: MobileMenu }) {
  const { user } = useAuth();
  const { year, monthIdx } = period;
  const cacheKey = `frais:payables:${user?.id ?? ""}:${year}`;
  const [items, setItems] = useState<Payable[] | null>(() => readCache<Payable[]>(cacheKey) ?? null);
  const [filter, setFilter] = useState<PayFilter>("unpaid");
  const [kind, setKind] = useState<PayKind>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(todayISO);

  const load = useCallback(
    () =>
      getPayables(year).then((res) => {
        if (!res.ok) return setError(res.error);
        setError(null);
        setItems(res.data);
        writeCache(cacheKey, res.data);
      }),
    [year, cacheKey]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(["expense_submissions", "notifications"], () => void load());

  const mark = async (p: Payable, on: string | null) => {
    setBusy(p.id);
    const res = await setPaid(p.kind, p.id, on);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    void load();
  };

  const q = normalize(query.trim());
  const matches = (p: Payable) => (filter === "all" || (filter === "paid") === !!p.paidAt) && (kind === "all" || p.kind === kind);
  const inYear = (items ?? []).filter((p) => yearOf(p.date) === year && (!q || normalize(`${p.personName} ${p.title}`).includes(q)));
  const inPeriod = inYear.filter((p) => monthIdx === null || monthIndexOf(p.date) === monthIdx);
  const visible = inPeriod.filter(matches);
  const monthStats = (m: number | null) => {
    const list = inYear.filter((p) => matches(p) && (m === null || monthIndexOf(p.date) === m));
    return { count: list.length, total: list.reduce((n, p) => n + p.amount, 0) };
  };
  const groups = new Map<string, Payable[]>();
  for (const p of visible) groups.set(monthKey(p.date), [...(groups.get(monthKey(p.date)) ?? []), p]);
  const due = inPeriod.filter((p) => !p.paidAt && (kind === "all" || p.kind === kind));

  return (
    <div className="space-y-3 md:flex md:items-start md:gap-4 md:space-y-0">
      {menu ? <PeriodMenu menu={menu} period={period} stats={monthStats} /> : <YearMonthBar year={year} onYear={period.setYear} month={monthIdx} onMonth={period.setMonthIdx} stats={monthStats} />}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-card px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Reste à payer · {monthIdx === null ? `année ${year}` : monthLabel(`${year}-${String(monthIdx + 1).padStart(2, "0")}`)}</div>
            <div className="text-xl font-extrabold text-ink">{euros(due.reduce((n, p) => n + p.amount, 0))}</div>
            <div className="text-[11px] text-ink-4">
              {due.length} élément{due.length > 1 ? "s" : ""} validé{due.length > 1 ? "s" : ""} non réglé{due.length > 1 ? "s" : ""}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-3">
            Payé le
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="rounded-btn border border-line bg-card px-2 py-1 text-sm outline-none" />
          </label>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {PAY_FILTERS.map((f) => (
            <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </FilterChip>
          ))}
          <span className="mx-1 w-px self-stretch bg-line" />
          {PAY_KINDS.map((k) => (
            <FilterChip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </FilterChip>
          ))}
        </div>
        <FiltersRow query={query} onQuery={setQuery} />
        {error && <p className="text-xs text-bad">{error}</p>}
        {!items ? (
          <div className="p-6 text-sm text-ink-4">Chargement…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-4">{filter === "unpaid" && !q ? "Tout ce qui est validé est payé. 👍" : "Rien ici."}</div>
        ) : (
          <div className="overflow-hidden rounded-panel border border-line bg-card">
            {[...groups.entries()].map(([key, list]) => (
              <div key={key}>
                <GroupHeader label={monthLabel(key)} count={list.length} total={list.reduce((n, p) => n + p.amount, 0)} />
                {list.map((p) => (
                  <div key={`${p.kind}:${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 md:flex-nowrap">
                    <div className="min-w-0 basis-full md:flex-1 md:basis-auto">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${p.kind === "invoice" ? "bg-warn-bg text-warn" : "bg-sel-bg text-link"}`}>
                          {p.kind === "invoice" ? "Facture" : "Frais"}
                        </span>
                        <span className="truncate text-sm font-bold text-ink">{p.personName}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-ink-4">
                        <span className="truncate">
                          {p.title} · {fmtDate(p.date)}
                        </span>
                        {p.eventId && <EventArrow eventId={p.eventId} className="h-5 w-5" />}
                      </div>
                    </div>
                    <span className="mr-auto shrink-0 text-sm font-bold text-ink md:mr-0">{euros(p.amount)}</span>
                    {p.paidAt ? (
                      <>
                        <span className="shrink-0 rounded-chip bg-good-bg px-1.5 py-0.5 text-[10px] font-bold text-good">
                          {p.kind === "invoice" ? "Payée" : "Remboursé"} le {new Date(p.paidAt).toLocaleDateString("fr-FR")}
                        </span>
                        <button
                          onClick={() => void mark(p, null)}
                          disabled={busy === p.id}
                          title="Annuler le paiement"
                          aria-label="Annuler le paiement"
                          className="shrink-0 rounded-md p-1 text-ink-4 hover:bg-hover disabled:opacity-50"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => void mark(p, paidOn)}
                        disabled={busy === p.id}
                        className="flex shrink-0 items-center gap-1 rounded-btn bg-good px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} {p.kind === "invoice" ? "Payée" : "Remboursé"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
