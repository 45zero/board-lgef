"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, ChevronLeft, ChevronRight, FileText, Loader2, Mail, RotateCcw, Search, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { readCache, writeCache } from "@/lib/board/localCache";
import { Popover } from "@/components/board/team/TeamUi";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { addMyReport, getInvoiceFiles, getStaffOverview, listReportCandidates, requestInvoices, reviewInvoice, setEventCostAdjustment, setStaffRate } from "@/app/actions/staff";
import { unwrap } from "@/lib/board/actionResult";
import {
  INVOICE_STATUS_LABELS,
  KM_RATE,
  STAFF_STATUS_LABELS,
  costTotals,
  euros,
  formatKm,
  invoiceMissing,
  type Engagement,
  type StaffOverview,
  type StaffPerson,
} from "@/lib/board/staff";
import { AmountInput } from "@/components/board/staff/AmountInput";

// Effectif : mes N-1 (tout l'effectif pour un administrateur), le forfait des prestataires, leurs
// interventions et ce qu'elles coûtent, mois par mois. « Engagé » : sollicitations confirmées ;
// « prévisionnel » : captations proposées, réponse attendue.

const MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const label = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4";

const STATUS_TONES: Record<string, string> = {
  "tech-prestataire": "bg-warn-bg text-warn",
  "tech-salarie": "bg-sel-bg text-link",
  "tech-reseau": "bg-good-bg text-good",
  "tech-benevole": "bg-chip-bg text-ink-3",
};

const monthOf = (iso: string) => new Date(iso).getMonth();

export function EffectifScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { user } = useAuth();
  // Dernière version connue affichée tout de suite (navigateur), puis remplacée par la fraîche.
  const cacheKey = `effectif:${user?.id ?? ""}:${year}:${scope}`;
  const [data, setData] = useState<StaffOverview | null>(() => readCache<StaffOverview>(cacheKey) ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Popup des interventions d'une personne (clic sur un chiffre) : un mois, et éventuellement engagé / prévisionnel.
  const [popup, setPopup] = useState<{ personId: string; month: number; filter: "all" | "confirmed" | "pending" } | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = unwrap(await getStaffOverview(year, scope));
      setData(fresh);
      writeCache(cacheKey, fresh);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [year, scope, cacheKey]);
  useEffect(() => {
    const cached = readCache<StaffOverview>(cacheKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- changement d'année / de vue : version connue d'abord, puis le réseau
    if (cached) setData(cached);
    void load();
  }, [load, cacheKey]);
  useLiveRefresh(["event_team_members", "event_assignments", "photo_missions", "events"], () => void load(), 1500);

  const toast = (m: string) => {
    setError(m);
    window.setTimeout(() => setError(null), 5000);
  };

  const byPerson = useMemo(() => {
    const map = new Map<string, Engagement[]>();
    for (const e of data?.engagements ?? []) map.set(e.userId, [...(map.get(e.userId) ?? []), e]);
    return map;
  }, [data]);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card text-sm text-ink-4">
        {error ?? <Loader2 size={18} className="animate-spin" />}
      </div>
    );
  }

  const { viewer, people } = data;
  if (!viewer.isAdmin && !viewer.hasReports) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-panel border border-line bg-card p-10 text-center">
        <Users size={28} className="text-ink-4" />
        <p className="text-sm font-bold text-ink-2">Personne ne vous a pour N+1 pour l&rsquo;instant.</p>
        <p className="max-w-sm text-xs text-ink-4">Le N+1 de chaque utilisateur se règle dans Administration → Utilisateurs.</p>
      </div>
    );
  }

  const monthEngagements = data.engagements.filter((e) => monthOf(e.start) === month);
  const totals = costTotals(monthEngagements);
  const yearTotals = costTotals(data.engagements);
  const person = selected ? people.find((p) => p.id === selected) : undefined;
  const needle = query.trim().toLowerCase();
  const shown = needle ? people.filter((p) => `${p.name} ${p.email ?? ""}`.toLowerCase().includes(needle)) : people;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-card">
        <header className="flex flex-wrap items-end gap-3 border-b border-line px-7 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <p className={label}>Effectif · N-1 &amp; coûts</p>
            <h1 className="mt-1 text-[28px] font-extrabold leading-tight text-ink">Effectif</h1>
            <p className="mt-1 text-sm text-ink-3">
              {people.length} personne{people.length > 1 ? "s" : ""} · {year} : {euros(yearTotals.confirmed)} engagés
              {yearTotals.pending > 0 && ` · ${euros(yearTotals.pending)} prévisionnels`}
            </p>
          </div>
          <div className="flex w-[220px] items-center gap-2 rounded-btn border border-line bg-panel px-3 py-2">
            <Search size={14} className="text-ink-4" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une personne…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Effacer">
                <X size={13} className="text-ink-4" />
              </button>
            )}
          </div>
          {viewer.isAdmin && <AddReport onAdded={load} onError={toast} />}
          {viewer.isAdmin && (
            <div className="flex rounded-btn border border-line bg-panel p-0.5 text-xs font-semibold">
              {(["mine", "all"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} className={`rounded-[9px] px-3 py-1.5 ${scope === s ? "bg-navy text-white" : "text-ink-3 hover:text-ink"}`}>
                  {s === "mine" ? "Mes N-1" : "Tout l'effectif"}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 rounded-btn border border-line bg-panel px-1 py-0.5">
            <button onClick={() => setYear((y) => y - 1)} aria-label="Année précédente" className="rounded-md p-1 text-ink-3 hover:bg-hover">
              <ChevronLeft size={15} />
            </button>
            <span className="w-12 text-center text-sm font-bold text-ink">{year}</span>
            <button onClick={() => setYear((y) => y + 1)} aria-label="Année suivante" className="rounded-md p-1 text-ink-3 hover:bg-hover">
              <ChevronRight size={15} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-5">
          {/* Mois */}
          <div className="flex flex-wrap gap-1">
            {MONTHS.map((m, i) => {
              const t = costTotals(data.engagements.filter((e) => monthOf(e.start) === i));
              return (
                <button
                  key={m}
                  onClick={() => setMonth(i)}
                  className={`rounded-btn border px-2.5 py-1.5 text-left ${month === i ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-2 hover:bg-hover"}`}
                >
                  <span className="block text-[11px] font-bold">{m}</span>
                  <span className={`block font-mono text-[10px] ${month === i ? "text-white/75" : "text-ink-4"}`}>{t.confirmed || t.pending ? euros(t.confirmed + t.pending) : "—"}</span>
                </button>
              );
            })}
          </div>

          {/* Chiffres du mois */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi title={`Engagé · ${MONTHS[month]}`} value={euros(totals.confirmed)} hint={`${totals.confirmedCount} intervention${totals.confirmedCount > 1 ? "s" : ""} confirmée${totals.confirmedCount > 1 ? "s" : ""}`} />
            <Kpi title="Prévisionnel" value={euros(totals.pending)} hint={`${totals.pendingCount} en attente de réponse`} tone="warn" />
            <Kpi title="Total du mois" value={euros(totals.confirmed + totals.pending)} hint="engagé + prévisionnel" />
            <Kpi
              title="Personnes sollicitées"
              value={String(new Set(monthEngagements.map((e) => e.userId)).size)}
              hint={`dont ${new Set(monthEngagements.filter((e) => e.amount > 0).map((e) => e.userId)).size} avec un coût`}
            />
          </div>

          {/* Personnes */}
          <div>
            <p className={`${label} mb-2`}>
              Personnes · {MONTHS[month]} {year}
            </p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-head text-left text-[11px] font-bold uppercase tracking-wide text-ink-4">
                  <tr>
                    <th className="px-4 py-2.5">Personne</th>
                    <th className="px-3 py-2.5">Statut</th>
                    {scope === "all" && <th className="px-3 py-2.5">N+1</th>}
                    <th className="px-3 py-2.5">Forfait / intervention</th>
                    <th className="px-3 py-2.5 text-right">Interventions</th>
                    <th className="px-3 py-2.5 text-right">Engagé</th>
                    <th className="px-4 py-2.5 text-right">Prévisionnel</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const t = costTotals((byPerson.get(p.id) ?? []).filter((e) => monthOf(e.start) === month));
                    return (
                      <tr key={p.id} onClick={() => setSelected(p.id)} className={`cursor-pointer border-t border-line hover:bg-hover ${selected === p.id ? "bg-sel-bg" : ""}`}>
                        <td className="px-4 py-2.5">
                          <p className="font-bold text-ink">{p.name}</p>
                          <p className="text-[11px] text-ink-4">{p.email}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          {p.status ? (
                            <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONES[p.status]}`}>{STAFF_STATUS_LABELS[p.status]}</span>
                          ) : (
                            <span className="text-xs text-ink-4">—</span>
                          )}
                        </td>
                        {scope === "all" && <td className="px-3 py-2.5 text-xs text-ink-3">{p.managerName ?? <span className="text-bad">Aucun</span>}</td>}
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {p.status === "tech-reseau" ? (
                            <span className="text-xs text-ink-3">
                              {KM_RATE.toLocaleString("fr-FR")} €/km
                              {monthKm(byPerson.get(p.id) ?? [], month) > 0 && <span className="text-ink-4"> · {formatKm(monthKm(byPerson.get(p.id) ?? [], month))}</span>}
                            </span>
                          ) : p.status === "tech-prestataire" || p.rate !== null ? (
                            <RateInput person={p} onSaved={load} onError={toast} />
                          ) : (
                            <span className="text-xs text-ink-4">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-2">
                          <Figure onClick={() => setPopup({ personId: p.id, month, filter: "all" })} disabled={!t.confirmedCount && !t.pendingCount}>
                            {t.confirmedCount}
                            {t.pendingCount > 0 && <span className="text-warn"> +{t.pendingCount}</span>}
                          </Figure>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-ink">
                          <Figure onClick={() => setPopup({ personId: p.id, month, filter: "confirmed" })} disabled={!t.confirmedCount}>
                            {t.confirmed ? euros(t.confirmed) : "—"}
                          </Figure>
                          <MissingInvoices count={(byPerson.get(p.id) ?? []).filter((e) => monthOf(e.start) === month && invoiceMissing(e, p.status)).length} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-warn">
                          <Figure onClick={() => setPopup({ personId: p.id, month, filter: "pending" })} disabled={!t.pendingCount}>
                            {t.pending ? euros(t.pending) : "—"}
                          </Figure>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink-4">
                        Personne à afficher.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mois par mois */}
          <div>
            <p className={`${label} mb-2`}>Mois par mois · {year} (engagé, + prévisionnel)</p>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-head text-[10px] font-bold uppercase tracking-wide text-ink-4">
                  <tr>
                    <th className="sticky left-0 bg-head px-4 py-2 text-left">Personne</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="px-2 py-2 text-right">
                        {m}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {shown
                    .filter((p) => (byPerson.get(p.id) ?? []).some((e) => e.amount > 0))
                    .map((p) => {
                      const list = byPerson.get(p.id) ?? [];
                      const yt = costTotals(list);
                      return (
                        <tr key={p.id} className="border-t border-line">
                          <td className="sticky left-0 bg-card px-4 py-2 font-semibold text-ink">{p.name}</td>
                          {MONTHS.map((_, i) => {
                            const t = costTotals(list.filter((e) => monthOf(e.start) === i));
                            return (
                              <td key={i} className={`px-2 py-2 text-right font-mono ${i === month ? "bg-sel-bg" : ""}`}>
                                <Figure onClick={() => setPopup({ personId: p.id, month: i, filter: "all" })} disabled={!t.confirmedCount && !t.pendingCount}>
                                  {t.confirmed ? <span className="text-ink">{euros(t.confirmed)}</span> : <span className="text-ink-4">·</span>}
                                  {t.pending > 0 && <span className="block text-[10px] text-warn">+{euros(t.pending)}</span>}
                                </Figure>
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right font-mono font-bold text-ink">
                            {euros(yt.confirmed)}
                            {yt.pending > 0 && <span className="block text-[10px] font-normal text-warn">+{euros(yt.pending)}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  <tr className="border-t-2 border-line-strong bg-head font-bold">
                    <td className="sticky left-0 bg-head px-4 py-2 text-ink">Total</td>
                    {MONTHS.map((_, i) => {
                      const t = costTotals(data.engagements.filter((e) => monthOf(e.start) === i));
                      return (
                        <td key={i} className="px-2 py-2 text-right font-mono text-ink">
                          {t.confirmed ? euros(t.confirmed) : "·"}
                          {t.pending > 0 && <span className="block text-[10px] font-normal text-warn">+{euros(t.pending)}</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right font-mono text-ink">
                      {euros(yearTotals.confirmed)}
                      {yearTotals.pending > 0 && <span className="block text-[10px] font-normal text-warn">+{euros(yearTotals.pending)}</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-4">Seules les personnes avec un coût apparaissent ici (forfait renseigné ou montant ajusté).</p>
          </div>
        </div>
      </section>

      {person && (
        <PersonDetail
          person={person}
          monthLabel={`${MONTHS[month]} ${year}`}
          engagements={(byPerson.get(person.id) ?? []).filter((e) => monthOf(e.start) === month)}
          onClose={() => setSelected(null)}
          onChanged={load}
          onError={toast}
        />
      )}
      {popup && people.find((p) => p.id === popup.personId) && (
        <InterventionsModal
          person={people.find((p) => p.id === popup.personId)!}
          title={`${MONTHS[popup.month]} ${year}${popup.filter === "confirmed" ? " · engagé" : popup.filter === "pending" ? " · prévisionnel" : ""}`}
          engagements={(byPerson.get(popup.personId) ?? []).filter(
            (e) => monthOf(e.start) === popup.month && (popup.filter === "all" || e.confirmed === (popup.filter === "confirmed"))
          )}
          onClose={() => setPopup(null)}
          onChanged={load}
          onError={toast}
        />
      )}
      {error && <div className="fixed bottom-6 right-6 z-[90] max-w-sm rounded-btn bg-ink px-4 py-3 text-sm text-white shadow-card">{error}</div>}
    </div>
  );
}

function Kpi({ title, value, hint, tone }: { title: string; value: string; hint: string; tone?: "warn" }) {
  return (
    <div className="rounded-card border border-line bg-panel px-4 py-3">
      <p className={label}>{title}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone === "warn" ? "text-warn" : "text-ink"}`}>{value}</p>
      <p className="text-[11px] text-ink-4">{hint}</p>
    </div>
  );
}

function RateInput({ person, onSaved, onError }: { person: StaffPerson; onSaved: () => Promise<void>; onError: (m: string) => void }) {
  return (
    <AmountInput
      key={`${person.id}-${person.rate}`}
      value={person.rate}
      placeholder="Tarif"
      onSave={async (v) => {
        const r = await setStaffRate(person.id, v);
        if (!r.ok) onError(r.error);
        await onSaved();
      }}
    />
  );
}

function PersonDetail({
  person,
  monthLabel,
  engagements,
  onClose,
  onChanged,
  onError,
}: {
  person: StaffPerson;
  monthLabel: string;
  engagements: Engagement[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const t = costTotals(engagements);
  return (
    <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-card">
      <div className="flex items-start gap-2 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className={label}>{monthLabel}</p>
          <p className="truncate text-lg font-extrabold text-ink">{person.name}</p>
          <p className="text-xs text-ink-3">
            {person.status ? STAFF_STATUS_LABELS[person.status] : "Sans statut"}
            {person.rate !== null && ` · forfait ${euros(person.rate)} / intervention`}
          </p>
        </div>
        <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1 text-ink-3 hover:bg-hover">
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-4 border-b border-line px-5 py-3 text-sm">
        <span>
          <b className="text-ink">{euros(t.confirmed)}</b> <span className="text-ink-4">engagés</span>
        </span>
        {t.pending > 0 && (
          <span>
            <b className="text-warn">{euros(t.pending)}</b> <span className="text-ink-4">prévisionnels</span>
          </span>
        )}
      </div>
      <InterventionList person={person} engagements={engagements} onChanged={onChanged} onError={onError} />
    </aside>
  );
}

const monthKm = (list: Engagement[], month: number) => list.filter((e) => monthOf(e.start) === month).reduce((n, e) => n + (e.km ?? 0), 0);

/** Chiffre cliquable : ouvre le détail des interventions correspondantes. */
function Figure({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  if (disabled) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Voir les interventions"
      className="rounded-md px-1 underline decoration-dotted underline-offset-2 hover:bg-hover hover:decoration-solid"
    >
      {children}
    </button>
  );
}

/** Interventions : clic sur l'événement → sa fiche ; montant modifiable pour cet événement. */
function InterventionList({
  person,
  engagements,
  onChanged,
  onError,
}: {
  person: StaffPerson;
  engagements: Engagement[];
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const { open, loadingId } = useOpenEvent();
  const base = (e: Engagement) => (e.km !== null ? Math.round(e.km * KM_RATE * 100) / 100 : person.rate);
  // Factures réclamées pendant la session (une ligne, ou toutes d'un coup).
  const [claimed, setClaimed] = useState<Record<string, string>>({});
  const missing = engagements.filter((e) => invoiceMissing(e, person.status) && !claimed[e.eventId]);
  const [bulk, setBulk] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const claimAll = async () => {
    setBulkBusy(true);
    const res = await requestInvoices(person.id, missing.map((e) => e.eventId), bulkNote);
    setBulkBusy(false);
    if (!res.ok) return onError(res.error);
    setClaimed((c) => ({ ...c, ...Object.fromEntries(missing.map((e) => [e.eventId, res.data.email])) }));
    setBulk(false);
  };
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
      {missing.length > 1 && (
        <li className="space-y-1.5 bg-bad-bg/50 px-5 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-bad" />
            <span className="flex-1 text-[12px] font-bold text-bad">{missing.length} factures non déposées</span>
            {!bulk && (
              <button
                type="button"
                onClick={() => setBulk(true)}
                className="flex items-center gap-1 rounded-btn bg-bad px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90"
              >
                <Mail size={11} /> Réclamer les {missing.length} factures
              </button>
            )}
          </div>
          {bulk && <ClaimForm busy={bulkBusy} note={bulkNote} onNote={setBulkNote} onSend={() => void claimAll()} onCancel={() => setBulk(false)} count={missing.length} />}
        </li>
      )}
      {engagements.length === 0 && <li className="px-5 py-6 text-center text-sm text-ink-4">Aucune intervention.</li>}
      {engagements.map((e) => (
        <li key={e.eventId} className="px-5 py-3">
          <button onClick={() => void open(e.eventId)} title="Ouvrir l'événement" className="group flex w-full items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10px] text-ink-4">
                {new Date(e.start).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {e.roles.join(", ")}
                {e.km !== null && ` · ${formatKm(e.km)} A/R`}
              </span>
              <span className="block truncate text-sm font-bold text-ink group-hover:text-link group-hover:underline">{e.title}</span>
            </span>
            <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-link group-hover:border-link group-hover:bg-sel-bg">
              {loadingId === e.eventId ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={13} strokeWidth={2.5} />}
            </span>
          </button>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${e.confirmed ? "bg-good-bg text-good" : "bg-warn-bg text-warn"}`}>{e.confirmed ? "Confirmé" : "Prévisionnel"}</span>
            <span className="flex-1" />
            <AmountInput
              key={`${e.eventId}-${e.amount}-${e.adjusted}`}
              value={e.amount}
              onSave={async (v) => {
                const r = await setEventCostAdjustment(e.eventId, person.id, v === null || v === base(e) ? null : v);
                if (!r.ok) onError(r.error);
                await onChanged();
              }}
            />
            {e.adjusted && (
              <button
                title="Revenir au montant calculé"
                onClick={async () => {
                  const r = await setEventCostAdjustment(e.eventId, person.id, null);
                  if (!r.ok) onError(r.error);
                  await onChanged();
                }}
                className="rounded-md p-1 text-ink-4 hover:bg-hover hover:text-ink"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
          {person.status === "tech-prestataire" && <InvoiceLine
              engagement={e}
              status={person.status}
              claimedTo={claimed[e.eventId] ?? null}
              onClaimed={(email) => setClaimed((c) => ({ ...c, [e.eventId]: email }))}
              onChanged={onChanged}
              onError={onError}
            />}
          {e.adjusted && base(e) !== null && <p className="mt-1 text-[10px] text-ink-4">Montant ajusté pour cet événement (calculé : {euros(base(e)!)}).</p>}
          {e.km === null && person.status === "tech-reseau" && <p className="mt-1 text-[10px] text-ink-4">Kilomètres inconnus (domicile ou lieu non renseigné) : saisissez le montant.</p>}
        </li>
      ))}
    </ul>
  );
}

function InterventionsModal({
  person,
  title,
  engagements,
  onClose,
  onChanged,
  onError,
}: {
  person: StaffPerson;
  title: string;
  engagements: Engagement[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const t = costTotals(engagements);
  const km = engagements.reduce((n, e) => n + (e.km ?? 0), 0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(6,14,28,0.45)] p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-modal bg-card shadow-modal">
        <div className="flex items-start gap-2 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className={label}>{title}</p>
            <p className="truncate text-lg font-extrabold text-ink">{person.name}</p>
            <p className="text-sm text-ink-3">
              <b className="text-ink">{euros(t.confirmed)}</b> engagés
              {t.pending > 0 && (
                <>
                  {" · "}
                  <b className="text-warn">{euros(t.pending)}</b> prévisionnels
                </>
              )}
              {km > 0 && ` · ${formatKm(km)} (${KM_RATE.toLocaleString("fr-FR")} €/km)`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-full p-1 text-ink-3 hover:bg-hover">
            <X size={16} />
          </button>
        </div>
        <InterventionList person={person} engagements={engagements} onChanged={onChanged} onError={onError} />
      </div>
    </div>
  );
}

/** Pastille « factures manquantes » d'une ligne du tableau. */
function MissingInvoices({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span title={`${count} facture${count > 1 ? "s" : ""} manquante${count > 1 ? "s" : ""} (interventions passées)`} className="ml-1 inline-flex items-center gap-0.5 align-middle text-[10px] font-bold text-bad">
      <AlertTriangle size={12} />
      {count}
    </span>
  );
}

/** Facture d'une intervention de prestataire : bouton pour la consulter, ou signal si elle manque. */
function InvoiceLine({
  engagement: e,
  status,
  claimedTo,
  onClaimed,
  onChanged,
  onError,
}: {
  engagement: Engagement;
  status: StaffPerson["status"];
  /** Adresse à qui la facture a été réclamée (ici ou via « Réclamer tout »). */
  claimedTo: string | null;
  onClaimed: (email: string) => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimNote, setClaimNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [motive, setMotive] = useState("");
  const [reviewing, setReviewing] = useState<"approved" | "rejected" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!e.invoice) {
    if (!invoiceMissing(e, status)) return null;
    // Réclamer : e-mail au prestataire (mot facultatif, infos de l'intervention, lien de dépôt).
    const claim = async () => {
      setBusy(true);
      const res = await requestInvoices(e.userId, [e.eventId], claimNote);
      setBusy(false);
      if (!res.ok) return onError(res.error);
      setClaiming(false);
      onClaimed(res.data.email);
    };
    return (
      <div className="mt-1.5 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-bad">
            <AlertTriangle size={12} /> Facture non déposée
          </span>
          {claimedTo ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-good">
              <Check size={12} /> Réclamée à {claimedTo}
            </span>
          ) : (
            !claiming && (
              <button
                type="button"
                onClick={() => setClaiming(true)}
                title="E-mail avec les infos de l'intervention et un lien pour déposer la facture directement"
                className="flex items-center gap-1 rounded-btn border border-bad/40 px-2 py-0.5 text-[11px] font-bold text-bad hover:bg-bad-bg"
              >
                <Mail size={11} /> Réclamer
              </button>
            )
          )}
        </div>
        {claiming && <ClaimForm busy={busy} note={claimNote} onNote={setClaimNote} onSend={() => void claim()} onCancel={() => setClaiming(false)} />}
      </div>
    );
  }
  const inv = e.invoice;
  const view = async () => {
    // Fenêtre ouverte tout de suite (sinon bloquée par le navigateur), remplie à la réponse.
    const win = window.open("", "_blank");
    setBusy(true);
    const res = await getInvoiceFiles(inv.id);
    setBusy(false);
    if (!res.ok || !res.data.length) {
      win?.close();
      onError(res.ok ? "Aucun fichier joint à cette facture." : res.error);
      return;
    }
    if (win) win.location.href = res.data[0].url;
    for (const f of res.data.slice(1)) window.open(f.url, "_blank");
  };
  const tone = inv.status === "approved" ? "bg-good-bg text-good" : inv.status === "rejected" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn";
  // Décision du N+1 : prestataire prévenu (board + e-mail) ; validée → copiée dans le Drive.
  const review = async (decision: "approved" | "rejected") => {
    setReviewing(decision);
    const res = await reviewInvoice(inv.id, decision, decision === "rejected" ? motive : undefined);
    setReviewing(null);
    if (!res.ok) return onError(res.error);
    setRejecting(false);
    setMotive("");
    setNotice(decision === "approved" ? (res.data.archived ? "Validée et archivée dans le Drive." : "Validée.") : "Refusée — le prestataire a reçu le motif et un lien pour en déposer une nouvelle.");
    await onChanged();
  };
  return (
    <div className="mt-1.5 space-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void view()}
        disabled={busy || inv.files === 0}
        className="flex items-center gap-1 rounded-btn border border-line px-2 py-1 text-[11px] font-bold text-link hover:border-link hover:bg-sel-bg disabled:opacity-50"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Consulter la facture
        {inv.files > 1 && <span className="font-normal text-ink-4">({inv.files} fichiers)</span>}
      </button>
      <span className={`rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>{INVOICE_STATUS_LABELS[inv.status ?? ""] ?? inv.status ?? "—"}</span>
      {inv.amountTtc !== null && (
        <span className={`text-[11px] ${inv.amountTtc !== e.amount ? "font-bold text-warn" : "text-ink-4"}`} title={inv.amountTtc !== e.amount ? "Montant facturé différent du montant prévu" : undefined}>
          {euros(inv.amountTtc)} TTC
        </span>
      )}
      {inv.status === "pending" && !rejecting && (
        <>
          <button
            type="button"
            onClick={() => void review("approved")}
            disabled={!!reviewing}
            className="flex items-center gap-1 rounded-btn bg-good px-2 py-1 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {reviewing === "approved" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Valider
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={!!reviewing}
            className="rounded-btn border border-bad/40 px-2 py-1 text-[11px] font-bold text-bad hover:bg-bad-bg disabled:opacity-50"
          >
            Refuser
          </button>
        </>
      )}
    </div>
    {rejecting && (
      <div className="flex items-start gap-2">
        <input
          autoFocus
          value={motive}
          onChange={(ev) => setMotive(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Enter" && motive.trim() && void review("rejected")}
          placeholder="Motif du refus (envoyé au prestataire)"
          className="min-w-0 flex-1 rounded-btn border border-line px-2 py-1 text-[12px] outline-none focus:border-line-strong"
        />
        <button
          type="button"
          onClick={() => void review("rejected")}
          disabled={!motive.trim() || !!reviewing}
          className="flex items-center gap-1 rounded-btn bg-bad px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {reviewing === "rejected" && <Loader2 size={11} className="animate-spin" />} Refuser
        </button>
        <button type="button" onClick={() => setRejecting(false)} aria-label="Annuler" className="rounded-md p-1 text-ink-4 hover:bg-hover">
          <X size={12} />
        </button>
      </div>
    )}
    {inv.status === "rejected" && inv.comment && <p className="text-[11px] text-bad">Motif du refus : {inv.comment}</p>}
    {notice && <p className="text-[11px] font-semibold text-good">{notice}</p>}
    </div>
  );
}

/** Administrateur : se désigner N+1 d'une personne depuis l'Effectif. */
function AddReport({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ id: string; name: string; email: string | null; managerName: string | null }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!list) {
      const res = await listReportCandidates();
      setList(res.ok ? res.data : []);
    }
  };
  const needle = q.trim().toLowerCase();
  const found = (list ?? []).filter((p) => !needle || `${p.name} ${p.email ?? ""}`.toLowerCase().includes(needle)).slice(0, 40);
  return (
    <div className="relative">
      <button onClick={() => void toggle()} className="flex items-center gap-1.5 rounded-btn bg-navy px-3 py-2 text-xs font-bold text-white hover:bg-navy-600">
        <UserPlus size={14} /> Ajouter un N-1
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" width={320}>
        <p className={`${label} mb-2`}>Je deviens le N+1 de…</p>
        <div className="mb-2 flex items-center gap-1.5 rounded-btn border border-line px-2 py-1.5">
          <Search size={13} className="text-ink-4" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une personne…" className="min-w-0 flex-1 text-[13px] outline-none" />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {list === null && <p className="px-1.5 py-2 text-xs text-ink-4">Chargement…</p>}
          {found.map((p) => (
            <button
              key={p.id}
              disabled={!!busy}
              onClick={async () => {
                setBusy(p.id);
                const res = await addMyReport(p.id);
                setBusy(null);
                if (!res.ok) return onError(res.error);
                setList((l) => (l ?? []).filter((x) => x.id !== p.id));
                setOpen(false);
                await onAdded();
              }}
              className="flex w-full items-center gap-2 rounded-btn px-1.5 py-1.5 text-left hover:bg-hover disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink-2">{p.name}</span>
                <span className="block truncate text-[10px] text-ink-4">{p.managerName ? `N+1 actuel : ${p.managerName}` : (p.email ?? "")}</span>
              </span>
              {busy === p.id && <Loader2 size={13} className="animate-spin text-ink-4" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Mot facultatif joint à la réclamation, puis envoi de l'e-mail. */
function ClaimForm({
  busy,
  note,
  onNote,
  onSend,
  onCancel,
  count = 1,
}: {
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
  count?: number;
}) {
  return (
    <div className="space-y-1.5 rounded-btn border border-line bg-card p-2">
      <textarea
        autoFocus
        value={note}
        onChange={(ev) => onNote(ev.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Message pour le prestataire (facultatif) — ex. merci d'indiquer le n° de match sur la facture"
        className="w-full resize-none rounded-btn border border-line px-2 py-1.5 text-[12px] outline-none focus:border-line-strong"
      />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-btn px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-hover">
          Annuler
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          className="flex items-center gap-1 rounded-btn bg-navy px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Envoyer {count > 1 ? `la réclamation (${count} factures)` : "la réclamation"}
        </button>
      </div>
    </div>
  );
}
