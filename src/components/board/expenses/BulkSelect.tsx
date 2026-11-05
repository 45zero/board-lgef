"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

// Sélection multiple des listes de la GED (notes de frais et factures à valider, paiements) : une case
// par ligne, puis une barre d'actions qui applique la même action à toutes les lignes cochées.

/** Lignes cochées parmi `selectable` (les clés qui ne sont plus affichées sortent de la sélection). */
export function useSelection(selectable: string[]) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const allowedKey = selectable.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recalcul seulement quand la liste des clés change
  const allowed = useMemo(() => new Set(selectable), [allowedKey]);
  const selected = useMemo(() => new Set([...picked].filter((k) => allowed.has(k))), [picked, allowed]);
  const toggle = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  /** Coche ou décoche d'un coup un groupe de lignes (tout le groupe coché → on le décoche). */
  const toggleMany = useCallback((keys: string[]) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const all = keys.length > 0 && keys.every((k) => next.has(k));
      for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setPicked(new Set()), []);
  const allSelected = allowed.size > 0 && selected.size === allowed.size;
  return { selected, toggle, toggleMany, clear, allSelected, selectAll: () => setPicked(allSelected ? new Set() : new Set(allowed)) };
}

/** Applique `run` à chaque élément, 3 à la fois (instance Supabase modeste) ; renvoie les erreurs. */
export async function runBulk<T>(items: T[], run: (item: T) => Promise<string | null>): Promise<string[]> {
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const err = await run(item);
        if (err) errors.push(err);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "Erreur inconnue");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return errors;
}

/** Résumé d'une action groupée, affiché sous la barre. `verb` au masculin singulier (« validé »). */
export function bulkReport(done: number, errors: string[], verb: string): string {
  const ok = done - errors.length;
  const head = `${ok} élément${ok > 1 ? "s" : ""} ${verb}${ok > 1 ? "s" : ""}`;
  if (!errors.length) return `${head}.`;
  return `${head}, ${errors.length} en échec : ${[...new Set(errors)].join(" · ")}`;
}

export function SelectBox({ checked, onChange, label, partial }: { checked: boolean; onChange: () => void; label: string; partial?: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !checked && !!partial;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      className="h-4 w-4 shrink-0 cursor-pointer accent-navy"
    />
  );
}

export type BulkAction = { label: string; tone: "good" | "bad" | "neutral"; onClick: () => void; icon?: React.ReactNode };

/**
 * Barre « Tout sélectionner » au-dessus de la liste ; une fois des lignes cochées : nombre, total et
 * actions groupées. `extra` : champ commun à l'action (commentaire de refus…).
 */
export function BulkBar({
  count,
  selectableCount,
  total,
  allSelected,
  onToggleAll,
  onClear,
  actions,
  busy,
  extra,
  message,
  className = "",
}: {
  count: number;
  selectableCount: number;
  total?: string;
  allSelected: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  actions: BulkAction[];
  busy: boolean;
  extra?: React.ReactNode;
  message?: string | null;
  /** Marges selon l'endroit (popup du tableau de bord…). */
  className?: string;
}) {
  if (!selectableCount && !message) return null;
  const tones = {
    good: "bg-good text-white",
    bad: "border border-bad text-bad hover:bg-bad/5",
    neutral: "border border-line text-ink-2 hover:bg-hover",
  };
  return (
    <div className={`sticky top-0 z-10 space-y-2 rounded-panel border px-3 py-2 ${count ? "border-navy bg-sel-bg" : "border-line bg-card"} ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {selectableCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-2">
            <SelectBox checked={allSelected} partial={count > 0} onChange={onToggleAll} label="Tout sélectionner" />
            {count ? (
              <span>
                {count} sélectionné{count > 1 ? "s" : ""}
                {total && <span className="font-bold text-ink"> · {total}</span>}
              </span>
            ) : (
              <span>Tout sélectionner ({selectableCount})</span>
            )}
          </label>
        )}
        {count > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {actions.map((a) => (
              <button
                key={a.label}
                disabled={busy}
                onClick={a.onClick}
                className={`flex items-center gap-1 rounded-btn px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${tones[a.tone]}`}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : a.icon} {a.label}
              </button>
            ))}
            <button disabled={busy} onClick={onClear} aria-label="Vider la sélection" title="Vider la sélection" className="rounded-md p-1 text-ink-4 hover:bg-hover disabled:opacity-50">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      {count > 0 && extra}
      {message && <p className="text-[11px] font-semibold text-ink-2">{message}</p>}
    </div>
  );
}
