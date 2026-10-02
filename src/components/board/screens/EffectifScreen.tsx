"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, RotateCcw, Users, X } from "lucide-react";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { useOpenEvent } from "@/components/board/calendar/EventOpener";
import { getStaffOverview, setEventCostAdjustment, setStaffRate } from "@/app/actions/staff";
import { unwrap } from "@/lib/board/actionResult";
import { KM_RATE, STAFF_STATUS_LABELS, costTotals, euros, formatKm, type Engagement, type StaffOverview, type StaffPerson } from "@/lib/board/staff";
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
  const [data, setData] = useState<StaffOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Popup des interventions d'une personne (clic sur un chiffre) : un mois, et éventuellement engagé / prévisionnel.
  const [popup, setPopup] = useState<{ personId: string; month: number; filter: "all" | "confirmed" | "pending" } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(unwrap(await getStaffOverview(year, scope)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [year, scope]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);
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
                  {people.map((p) => {
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
                        </td>
                        <td className="px-4 py-2.5 text-right text-warn">
                          <Figure onClick={() => setPopup({ personId: p.id, month, filter: "pending" })} disabled={!t.pendingCount}>
                            {t.pending ? euros(t.pending) : "—"}
                          </Figure>
                        </td>
                      </tr>
                    );
                  })}
                  {people.length === 0 && (
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
                  {people
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
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
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
