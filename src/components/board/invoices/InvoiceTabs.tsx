"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { EventArrow } from "@/components/board/calendar/EventOpener";
import { confirmMyInvoiceUpload, getMyInvoiceItems, getStaffOverview, prepareMyInvoiceUpload } from "@/app/actions/staff";
import type { InvoiceRequestItem } from "@/app/actions/invoice-public";
import { InvoiceItemCard, stateOf, type InvoiceItemState } from "@/components/invoice/InvoiceUploadCard";
import { InvoiceLine } from "@/components/board/invoices/InvoiceLine";
import { euros, invoiceMissing, type Engagement, type StaffOverview } from "@/lib/board/staff";
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
// de chacune de ses interventions) et « Prestataires » (N+1 : ses prestataires ; GED : tous), par mois.

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

  const load = useCallback(
    () =>
      getMyInvoiceItems(year).then((res) => {
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
      </div>
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

  const load = useCallback(
    () =>
      getStaffOverview(year, scope).then((res) => {
        if (!res.ok) return setError(res.error);
        setError(null);
        setData(res.data);
        writeCache(cacheKey, res.data);
      }),
    [year, scope, cacheKey]
  );
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh([...LIVE], () => void load());

  const people = useMemo(() => new Map((data?.people ?? []).filter((p) => p.status === PRESTATAIRE).map((p) => [p.id, p])), [data]);
  const bucketOf = (e: Engagement): ReviewFilter | null =>
    e.invoice ? (e.invoice.status === "approved" ? "approved" : e.invoice.status === "rejected" ? "rejected" : "pending") : invoiceMissing(e, PRESTATAIRE) ? "missing" : null;
  const q = normalize(query.trim());
  const inYear = (data?.engagements ?? []).filter(
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
                  <GroupHeader label={person.name} count={list.length} total={list.reduce((n, e) => n + lineAmount(e), 0)} />
                  {list.map((e) => (
                    <div key={`${e.userId}|${e.eventId}`} className="border-b border-line px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-ink">{e.title}</span>
                            <EventArrow eventId={e.eventId} className="h-6 w-6" />
                          </div>
                          <div className="text-[11px] text-ink-4">
                            {fmtDate(e.start)} · {e.roles.join(", ")}
                          </div>
                        </div>
                        {e.amount > 0 && <span className="shrink-0 text-xs text-ink-3">Prévu : {euros(e.amount)}</span>}
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
      </div>
    </div>
  );
}
