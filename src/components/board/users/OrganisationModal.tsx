"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { addDelegation, getOrganisation, removeDelegation, setServiceManager, type Delegation, type Organisation } from "@/app/actions/organisation";
import { setUserManager } from "@/app/actions/users-admin";
import { unwrap } from "@/lib/board/actionResult";
import type { ApprovalAction } from "@/lib/board/hierarchy";

const input = "w-full rounded-btn border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-navy disabled:opacity-60";
const fieldTitle = "text-[11px] font-bold uppercase tracking-wide text-ink-4";
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");
const frDate = (d: string) => d.split("-").reverse().join("/");
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

type Tab = "services" | "delegations";
type Run = (fn: () => Promise<unknown>, message: string) => Promise<boolean>;

function delegationState(d: Delegation): { label: string; tone: string } {
  const t = today();
  if (d.endsOn && d.endsOn < t) return { label: "Terminée", tone: "bg-subtle text-ink-4" };
  if (d.startsOn && d.startsOn > t) return { label: "À venir", tone: "bg-sel-bg text-ink" };
  return { label: "Active", tone: "bg-good-bg text-good" };
}

/**
 * Paramètres → Organisation : un responsable par service (N+1 par défaut de ceux qui y sont rattachés),
 * à qui il rend compte (son propre N+1, donc le N+2 du service), et les délégations (« je confie la
 * validation des frais à X du … au … »). Les administrateurs règlent tout ; chacun voit l'organigramme
 * et gère ses propres délégations s'il a une équipe ou dirige un service.
 */
export function OrganisationModal({ onClose }: { onClose: () => void }) {
  const [org, setOrg] = useState<Organisation | null>(null);
  const [tab, setTab] = useState<Tab>("services");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getOrganisation()
        .then((r) => setOrg(unwrap(r)))
        .catch((e) => setError(errorMessage(e))),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run: Run = async (fn, message) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Paramètres</div>
            <h3 className="mt-1 text-base font-extrabold">Organisation</h3>
            <div className="mt-0.5 text-xs text-white/80">Responsables de service, N+1 / N+2 et délégations</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="flex shrink-0 gap-1.5 border-b border-line px-4 py-2.5">
          {(
            [
              ["services", "Services"],
              ["delegations", "Délégations"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === id ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"}`}
            >
              {label}
              {id === "delegations" && org && org.delegations.length > 0 && <span className="ml-1 opacity-70">{org.delegations.length}</span>}
            </button>
          ))}
        </div>

        {error && <div className="mx-4 mt-3 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}
        {notice && <div className="mx-4 mt-3 rounded-btn bg-sel-bg px-3 py-2 text-sm font-semibold text-ink">{notice}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!org ? (
            !error && <p className="p-6 text-center text-sm text-ink-4">Chargement…</p>
          ) : tab === "services" ? (
            <ServicesTab org={org} run={run} />
          ) : (
            <DelegationsTab org={org} run={run} />
          )}
        </div>
      </div>
    </div>
  );
}

function ServicesTab({ org, run }: { org: Organisation; run: Run }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const person = useMemo(() => new Map(org.people.map((p) => [p.id, p])), [org.people]);
  const nameOf = (id: string | null) => (id ? (person.get(id)?.name ?? "—") : null);
  const unassigned = org.people.filter((p) => !p.homeService).length;
  const isAdmin = org.me.isAdmin;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-3">
        Le responsable d&apos;un service est le <strong>N+1 par défaut</strong> de toutes les personnes qui y sont rattachées (le rattachement se règle dans
        Utilisateurs, ou à l&apos;acceptation d&apos;une demande de compte). Son propre N+1 devient le <strong>N+2</strong> du service. Un N+1 choisi pour une
        personne précise reste prioritaire.
      </p>

      {org.services.map((s) => {
        const members = org.people.filter((p) => p.homeService === s.key);
        const manager = s.managerId ? person.get(s.managerId) : null;
        const open = openKey === s.key;
        return (
          <div key={s.key} className="rounded-btn border border-line">
            <div className="grid gap-2 p-3 sm:grid-cols-[1fr_1.3fr_1.3fr] sm:items-end">
              <button onClick={() => setOpenKey(open ? null : s.key)} className="flex items-center gap-1.5 self-center text-left">
                {open ? <ChevronDown size={14} className="text-ink-4" /> : <ChevronRight size={14} className="text-ink-4" />}
                <span>
                  <span className="block text-sm font-bold text-ink">{s.label}</span>
                  <span className="block text-[11px] text-ink-4">
                    {members.length} personne{members.length > 1 ? "s" : ""} rattachée{members.length > 1 ? "s" : ""}
                  </span>
                </span>
              </button>
              <label className="block space-y-1">
                <span className={fieldTitle}>Responsable (N+1)</span>
                <select
                  value={s.managerId ?? ""}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    void run(
                      async () => unwrap(await setServiceManager(s.key, e.target.value || null)),
                      e.target.value ? `${nameOf(e.target.value)} est responsable du service ${s.label}.` : `Service ${s.label} sans responsable.`
                    )
                  }
                  className={input}
                >
                  <option value="">Pas encore désigné</option>
                  {org.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className={fieldTitle}>Rend compte à (N+2)</span>
                <select
                  value={manager?.managerId ?? ""}
                  disabled={!isAdmin || !manager}
                  onChange={(e) =>
                    manager &&
                    void run(
                      async () => unwrap(await setUserManager(manager.id, e.target.value || null)),
                      e.target.value ? `${manager.name} rend compte à ${nameOf(e.target.value)}.` : `${manager.name} n'a plus de N+1.`
                    )
                  }
                  className={input}
                >
                  <option value="">{manager ? "Personne (sommet)" : "—"}</option>
                  {org.people
                    .filter((p) => p.id !== manager?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {open && (
              <div className="border-t border-line px-3 py-2">
                {members.length === 0 ? (
                  <p className="py-1 text-xs text-ink-4">Personne n&apos;est encore rattaché à ce service.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                        <span className="font-semibold text-ink">{m.name}</span>
                        <span className="text-ink-4">
                          N+1 : {nameOf(m.managerId) ?? "aucun"}
                          {m.managerId && m.managerId !== s.managerId && <span className="ml-1 rounded-full bg-subtle px-1.5 py-0.5 text-[10px]">choisi</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {unassigned > 0 && (
        <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">
          {unassigned} compte{unassigned > 1 ? "s" : ""} sans service de rattachement : leur N+1 reste celui choisi personnellement (ou aucun).
        </p>
      )}
    </div>
  );
}

function DelegationsTab({ org, run }: { org: Organisation; run: Run }) {
  const person = useMemo(() => new Map(org.people.map((p) => [p.id, p])), [org.people]);
  const nameOf = (id: string) => person.get(id)?.name ?? "—";
  const serviceLabel = (key: string | null) => (key ? `Service ${org.services.find((s) => s.key === key)?.label ?? key}` : "Tout le périmètre");
  const actionLabel = (key: string) => org.actions.find((a) => a.key === key)?.label ?? key;
  const { me } = org;
  const canDelegate = me.isAdmin || me.teamSize > 0 || me.managedServices.length > 0;

  const [delegatorId, setDelegatorId] = useState(me.id);
  const [delegateId, setDelegateId] = useState("");
  const [action, setAction] = useState<ApprovalAction>(org.actions[0]?.key ?? "frais");
  const [serviceKey, setServiceKey] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");

  const given = org.delegations.filter((d) => d.delegatorId === me.id);
  const received = org.delegations.filter((d) => d.delegateId === me.id);
  const others = me.isAdmin ? org.delegations.filter((d) => d.delegatorId !== me.id && d.delegateId !== me.id) : [];

  const submit = async () => {
    const ok = await run(
      async () =>
        unwrap(
          await addDelegation({
            delegatorId,
            delegateId,
            action,
            serviceKey: serviceKey || null,
            startsOn: startsOn || null,
            endsOn: endsOn || null,
            note: note || null,
          })
        ),
      `${actionLabel(action)} confiées à ${nameOf(delegateId)}, qui est prévenu.`
    );
    if (ok) {
      setDelegateId("");
      setStartsOn("");
      setEndsOn("");
      setNote("");
    }
  };

  const row = (d: Delegation) => {
    const state = delegationState(d);
    return (
      <li key={d.id} className="flex items-start justify-between gap-2 py-2">
        <div className="min-w-0 text-xs">
          <div className="flex flex-wrap items-center gap-1 font-semibold text-ink">
            {nameOf(d.delegatorId)} <ArrowRight size={11} className="text-ink-4" /> {nameOf(d.delegateId)}
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${state.tone}`}>{state.label}</span>
          </div>
          <div className="text-ink-3">
            {actionLabel(d.action)} · {serviceLabel(d.serviceKey)}
            {(d.startsOn || d.endsOn) && ` · ${d.startsOn ? `du ${frDate(d.startsOn)} ` : ""}${d.endsOn ? `au ${frDate(d.endsOn)}` : "sans fin"}`}
          </div>
          {d.note && <div className="text-ink-4">« {d.note} »</div>}
        </div>
        <button
          onClick={() => confirm("Retirer cette délégation ?") && void run(async () => unwrap(await removeDelegation(d.id)), "Délégation retirée.")}
          className="shrink-0 rounded-btn p-1.5 text-ink-4 hover:bg-hover hover:text-bad"
          title={d.delegateId === me.id ? "Renoncer" : "Retirer"}
        >
          <Trash2 size={13} />
        </button>
      </li>
    );
  };

  const section = (title: string, list: Delegation[], empty: string) => (
    <div>
      <div className={`${fieldTitle} mb-1`}>{title}</div>
      {list.length === 0 ? <p className="text-xs text-ink-4">{empty}</p> : <ul className="divide-y divide-line">{list.map(row)}</ul>}
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-3">
        Déléguer, c&apos;est confier une validation (frais, demandes de compte…) à quelqu&apos;un, pour tout votre périmètre ou un seul service, en permanence
        ou sur une période (congés). Vous gardez le droit de valider vous-même ; votre N+1 et les administrateurs aussi.
      </p>

      {canDelegate ? (
        <div className="space-y-2 rounded-btn border border-line p-3">
          <div className="text-sm font-bold text-ink">Nouvelle délégation</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {me.isAdmin && (
              <label className="block space-y-1">
                <span className={fieldTitle}>Qui délègue</span>
                <select value={delegatorId} onChange={(e) => setDelegatorId(e.target.value)} className={input}>
                  {org.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === me.id ? `${p.name} (moi)` : p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block space-y-1">
              <span className={fieldTitle}>Quoi</span>
              <select value={action} onChange={(e) => setAction(e.target.value as ApprovalAction)} className={input}>
                {org.actions.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className={fieldTitle}>À qui</span>
              <select value={delegateId} onChange={(e) => setDelegateId(e.target.value)} className={input}>
                <option value="">Choisir…</option>
                {org.people
                  .filter((p) => p.id !== delegatorId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className={fieldTitle}>Pour</span>
              <select value={serviceKey} onChange={(e) => setServiceKey(e.target.value)} className={input}>
                <option value="">Tout le périmètre</option>
                {org.services.map((s) => (
                  <option key={s.key} value={s.key}>
                    Service {s.label} seulement
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className={fieldTitle}>Du (facultatif)</span>
                <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={input} />
              </label>
              <label className="block space-y-1">
                <span className={fieldTitle}>Au (facultatif)</span>
                <input type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} className={input} />
              </label>
            </div>
            <label className="block space-y-1 sm:col-span-2">
              <span className={fieldTitle}>Note (facultatif)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : congés de fin d'année" className={input} />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              disabled={!delegateId}
              onClick={() => void submit()}
              className="flex items-center gap-1 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              <Plus size={12} /> Déléguer
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-btn bg-subtle px-3 py-2 text-xs text-ink-3">Vous n&apos;avez personne sous votre responsabilité : rien à déléguer pour l&apos;instant.</p>
      )}

      {(canDelegate || given.length > 0) && section("Je délègue", given, "Aucune délégation.")}
      {section("On me délègue", received, "Personne ne vous a délégué de validation.")}
      {me.isAdmin && section("Autres délégations", others, "Aucune autre délégation.")}
    </div>
  );
}
