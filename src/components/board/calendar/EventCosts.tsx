"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { getEventCosts, setEventCostAdjustment, type EventCostLine } from "@/app/actions/staff";
import { KM_RATE, STAFF_STATUS_LABELS, costTotals, euros, formatKm } from "@/lib/board/staff";
import { AmountInput } from "@/components/board/staff/AmountInput";

/**
 * Coût des intervenants d'un événement, pour leur N+1 (ou un administrateur) : chaque personne
 * sollicitée dont il a la charge, son forfait ou le montant ajusté pour cet événement (modifiable).
 * Rien ne s'affiche pour les autres lecteurs, ni quand personne n'a de coût.
 */
export function EventCosts({ eventId }: { eventId: string }) {
  const [lines, setLines] = useState<EventCostLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await getEventCosts(eventId);
    if (res.ok) setLines(res.data);
  }, [eventId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'à la réponse du serveur
    void load();
  }, [load]);

  const shown = (lines ?? []).filter((l) => l.amount > 0 || l.status === "tech-prestataire" || l.status === "tech-reseau");
  if (!shown.length) return null;
  const t = costTotals(shown);

  const save = async (l: EventCostLine, amount: number | null) => {
    const base = l.km !== null ? Math.round(l.km * KM_RATE * 100) / 100 : l.rate;
    const res = await setEventCostAdjustment(eventId, l.userId, amount === null || amount === base ? null : amount);
    setError(res.ok ? null : res.error);
    await load();
  };

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">Coût des intervenants</span>
        <span className="text-xs font-bold text-ink">{euros(t.confirmed)}</span>
        {t.pending > 0 && <span className="text-xs font-semibold text-warn">+ {euros(t.pending)} prévisionnel</span>}
      </div>
      <div className="divide-y divide-line rounded-btn border border-line">
        {shown.map((l) => (
          <div key={l.userId} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
              <p className="text-[11px] text-ink-4">
                {[
                  l.status ? STAFF_STATUS_LABELS[l.status] : null,
                  l.roles.join(", "),
                  l.confirmed ? "confirmé" : "prévisionnel",
                  l.km !== null ? `${formatKm(l.km)} A/R à ${KM_RATE.toLocaleString("fr-FR")} €/km` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {l.adjusted && l.rate !== null && ` · forfait ${euros(l.rate)}`}
              </p>
            </div>
            <AmountInput key={`${l.userId}-${l.amount}`} value={l.amount} onSave={(v) => save(l, v)} />
            {l.adjusted && (
              <button type="button" title="Revenir au forfait" onClick={() => void save(l, null)} className="rounded-md p-1 text-ink-4 hover:bg-hover hover:text-ink">
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      <p className="mt-1 text-[10px] text-ink-4">Visible de leur N+1 et des administrateurs. Modifier un montant l&rsquo;ajuste pour cet événement seulement.</p>
    </div>
  );
}
