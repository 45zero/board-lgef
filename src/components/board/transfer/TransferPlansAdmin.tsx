"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Save, UserPlus } from "lucide-react";
import { unwrap } from "@/lib/board/actionResult";
import { GB } from "@/lib/transfer/shared";
import {
  deleteTransferAssignment,
  deleteTransferPlan,
  listTransferPlans,
  saveTransferAssignment,
  saveTransferPlan,
  type TransferAssignmentRow,
  type TransferPlanRow,
} from "@/app/actions/transfers";

// Formules de LGEF Transfer (admins) : taille max (Go) et durée max (jours) — vide = illimité —,
// formule par défaut (sans compte) et formule des membres du board ; puis attribution d'une formule
// à une adresse précise (ex. formule payée jusqu'au…).

type Draft = { id: string | null; name: string; description: string; sizeGb: string; days: string; isDefault: boolean; isMembersDefault: boolean; canArchive: boolean };

const toDraft = (p?: TransferPlanRow): Draft => ({
  id: p?.id ?? null,
  name: p?.name ?? "",
  description: p?.description ?? "",
  sizeGb: p?.maxSizeBytes ? String(+(p.maxSizeBytes / GB).toFixed(2)) : "",
  days: p?.maxDays ? String(p.maxDays) : "",
  isDefault: p?.isDefault ?? false,
  isMembersDefault: p?.isMembersDefault ?? false,
  canArchive: p?.canArchive ?? false,
});

const limits = (p: TransferPlanRow) =>
  `${p.maxSizeBytes === null ? "Taille illimitée" : `${+(p.maxSizeBytes / GB).toFixed(2)} Go`} · ${p.maxDays === null ? "durée illimitée" : `${p.maxDays} jours`}${p.canArchive ? " · archivage" : ""}`;

const EMPTY_ASSIGN = { email: "", planId: "", validUntil: "", note: "" };

export function TransferPlansAdmin() {
  const [data, setData] = useState<{ plans: TransferPlanRow[]; assignments: TransferAssignmentRow[]; people: { email: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [assign, setAssign] = useState(EMPTY_ASSIGN);

  const load = useCallback(() => {
    listTransferPlans()
      .then((r) => setData(unwrap(r)))
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async () => {
    if (!draft) return;
    const size = draft.sizeGb.trim() ? Number(draft.sizeGb.replace(",", ".")) : null;
    const days = draft.days.trim() ? Number(draft.days) : null;
    const ok = await run(async () =>
      unwrap(
        await saveTransferPlan({
          id: draft.id,
          name: draft.name,
          description: draft.description,
          maxSizeBytes: size === null ? null : size * GB,
          maxDays: days,
          isDefault: draft.isDefault,
          isMembersDefault: draft.isMembersDefault,
          canArchive: draft.canArchive,
        })
      )
    );
    if (ok) setDraft(null);
  };

  const removePlan = async (id: string) => {
    if (!window.confirm("Supprimer cette formule ? Ses attributions seront retirées.")) return;
    if (await run(async () => unwrap(await deleteTransferPlan(id)))) setDraft(null);
  };

  const saveAssign = async () => {
    if (await run(async () => unwrap(await saveTransferAssignment({ ...assign, validUntil: assign.validUntil || null })))) setAssign(EMPTY_ASSIGN);
  };

  if (!data) return error ? <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p> : <Loader2 size={18} className="animate-spin text-ink-4" />;

  const planName = (id: string) => data.plans.find((p) => p.id === id)?.name ?? "—";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-extrabold text-ink">Formules</h2>
            <p className="text-xs text-ink-4">Limites par transfert. Champ vide = illimité.</p>
          </div>
          <button onClick={() => setDraft(toDraft())} className="flex items-center gap-1.5 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white">
            <Plus size={13} /> Formule
          </button>
        </header>
        <ul className="divide-y divide-line">
          {data.plans.map((p) => (
            <li key={p.id}>
              <button onClick={() => setDraft(toDraft(p))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink">
                    {p.name}
                    {p.isDefault && <span className="rounded-chip bg-sel-bg px-1.5 text-[10px] font-bold text-link">Sans compte</span>}
                    {p.isMembersDefault && <span className="rounded-chip bg-good-bg px-1.5 text-[10px] font-bold text-good">Membres du board</span>}
                  </p>
                  <p className="text-xs text-ink-3">{limits(p)}</p>
                  {p.description && <p className="text-[11px] text-ink-4">{p.description}</p>}
                </div>
                <span className="text-[11px] text-ink-4">
                  {p.assignedCount} attribution{p.assignedCount > 1 ? "s" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {draft && (
          <div className="space-y-2 border-t border-line bg-subtle p-4">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nom (ex. Club partenaire)" className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none" />
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Description (facultatif)"
              className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-2 text-sm">
                <input value={draft.sizeGb} onChange={(e) => setDraft({ ...draft, sizeGb: e.target.value })} inputMode="decimal" placeholder="∞" className="w-full min-w-0 text-right outline-none" aria-label="Taille maximale en Go" />
                <span className="text-ink-4">Go</span>
              </label>
              <label className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-3 py-2 text-sm">
                <input
                  value={draft.days}
                  onChange={(e) => setDraft({ ...draft, days: e.target.value.replace(/\D/g, "") })}
                  inputMode="numeric"
                  placeholder="∞"
                  className="w-full min-w-0 text-right outline-none"
                  aria-label="Durée maximale en jours"
                />
                <span className="text-ink-4">jours</span>
              </label>
            </div>
            <div className="flex flex-col gap-1 text-xs text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.canArchive} onChange={(e) => setDraft({ ...draft, canArchive: e.target.checked })} /> Peut archiver dans le Drive (fichiers gardés après expiration)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} /> Formule des expéditeurs sans compte
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.isMembersDefault} onChange={(e) => setDraft({ ...draft, isMembersDefault: e.target.checked })} /> Formule de tous les membres du board
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => void savePlan()} disabled={busy} className="flex items-center gap-1.5 rounded-btn bg-red px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Enregistrer
              </button>
              <button onClick={() => setDraft(null)} className="rounded-btn px-3 py-1.5 text-xs font-semibold text-ink-3 hover:bg-hover">
                Annuler
              </button>
              {draft.id && (
                <button onClick={() => void removePlan(draft.id!)} className="ml-auto flex items-center gap-1 rounded-btn px-2 py-1.5 text-xs font-semibold text-bad hover:bg-bad-bg">
                  <Trash2 size={13} /> Supprimer
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-card">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-extrabold text-ink">Attributions</h2>
          <p className="text-xs text-ink-4">Une formule pour une adresse précise (prioritaire) — ex. formule payée jusqu&rsquo;à une date.</p>
        </header>
        <div className="space-y-2 border-b border-line p-4">
          <input
            value={assign.email}
            onChange={(e) => setAssign({ ...assign, email: e.target.value })}
            list="transfer-people"
            type="email"
            placeholder="Adresse e-mail (membre ou externe)"
            className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none"
          />
          <datalist id="transfer-people">
            {data.people.map((p) => (
              <option key={p.email} value={p.email}>
                {p.name}
              </option>
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-2">
            <select value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })} className="rounded-btn border border-line bg-card px-2 py-2 text-sm outline-none" aria-label="Formule">
              <option value="">Formule…</option>
              {data.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 rounded-btn border border-line bg-card px-2 text-xs text-ink-3">
              Jusqu&rsquo;au
              <input type="date" value={assign.validUntil} onChange={(e) => setAssign({ ...assign, validUntil: e.target.value })} className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none" />
            </label>
          </div>
          <input value={assign.note} onChange={(e) => setAssign({ ...assign, note: e.target.value })} placeholder="Note (ex. payé le 12/10, facture n°…)" className="w-full rounded-btn border border-line bg-card px-3 py-2 text-sm outline-none" />
          <button onClick={() => void saveAssign()} disabled={busy || !assign.email || !assign.planId} className="flex items-center gap-1.5 rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            <UserPlus size={13} /> Attribuer
          </button>
        </div>
        {error && <p className="m-4 rounded-btn bg-bad-bg px-3 py-2 text-xs text-bad">{error}</p>}
        <ul className="divide-y divide-line">
          {data.assignments.length === 0 && <li className="px-4 py-6 text-center text-xs text-ink-4">Aucune attribution : chacun a la formule par défaut ou celle des membres.</li>}
          {data.assignments.map((a) => {
            const expired = !!a.validUntil && a.validUntil < today;
            return (
              <li key={a.email} className="flex items-center gap-3 px-4 py-2.5">
                <button onClick={() => setAssign({ email: a.email, planId: a.planId, validUntil: a.validUntil ?? "", note: a.note })} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-ink">
                    {a.memberName ? `${a.memberName} · ` : ""}
                    <span className="font-normal text-ink-3">{a.email}</span>
                  </p>
                  <p className={`text-xs ${expired ? "text-bad" : "text-ink-3"}`}>
                    {planName(a.planId)} · {a.validUntil ? `${expired ? "expirée le" : "jusqu'au"} ${new Date(a.validUntil).toLocaleDateString("fr-FR")}` : "sans fin"}
                    {a.note && ` · ${a.note}`}
                  </p>
                </button>
                <button onClick={() => void run(async () => unwrap(await deleteTransferAssignment(a.email)))} className="rounded-full p-1.5 text-ink-4 hover:bg-hover hover:text-bad" aria-label={`Retirer l'attribution de ${a.email}`}>
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
