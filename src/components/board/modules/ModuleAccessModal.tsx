"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Lock, Users, X } from "lucide-react";
import { getModuleAccessAdmin, type ModuleAccessAdmin } from "@/app/actions/module-access";
import { unwrap } from "@/lib/board/actionResult";
import { BUILT_MODULES, CONFIGURABLE_MODULES, GROUP_CHOICES, ROLE_CHOICES, type ModuleRule } from "@/lib/board/modules";
import { buildPoles, type Pole } from "@/lib/board/poles";
import { ModuleAccessEditor } from "@/components/board/modules/ModuleAccessEditor";

/** Résumé d'une règle pour la liste : « Tout le monde » ou « Formation · Photographes · +2 · −1 ». */
function describe(rule: ModuleRule | undefined, poles: Pole[]) {
  if (!rule) return "Tout le monde";
  const parts: string[] = [];
  if (rule.everyone) parts.push("Tout le monde");
  else {
    for (const p of poles) if (p.slugs.some((s) => rule.specialtySlugs.includes(s))) parts.push(p.label);
    for (const g of GROUP_CHOICES) if (rule.specialtySlugs.includes(g.slug)) parts.push(g.label);
    for (const r of ROLE_CHOICES) if (rule.roles.includes(r.id)) parts.push(r.label);
    if (rule.includeUserIds.length) parts.push(`+${rule.includeUserIds.length} personne${rule.includeUserIds.length > 1 ? "s" : ""}`);
    if (parts.length === 0) parts.push("Administrateurs uniquement");
  }
  if (rule.excludeUserIds.length) parts.push(`−${rule.excludeUserIds.length}`);
  return parts.join(" · ");
}

/** Charge l'annuaire et les règles une fois ; `children` reçoit les données (fenêtre ou encart). */
export function useModuleAccessAdmin() {
  const [data, setData] = useState<ModuleAccessAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      getModuleAccessAdmin()
        .then(unwrap)
        .then(setData)
        .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible.")),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);
  const applySaved = (rule: ModuleRule) => setData((d) => (d ? { ...d, rules: { ...d.rules, [rule.moduleId]: rule } } : d));
  return { data, error, applySaved };
}

/**
 * Paramètres → Accès aux modules (et bouton « Accès » de la barre du haut) : tous les modules avec
 * leur règle, et l'éditeur du module choisi. Administrateurs et super users.
 */
export function ModuleAccessModal({ initialModuleId, onClose }: { initialModuleId?: string; onClose: () => void }) {
  const { data, error, applySaved } = useModuleAccessAdmin();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialModuleId && CONFIGURABLE_MODULES.some((m) => m.id === initialModuleId) ? initialModuleId : null
  );
  const poles = useMemo(() => buildPoles(data?.specialties ?? []), [data]);
  const selected = CONFIGURABLE_MODULES.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-modal bg-card shadow-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 bg-navy px-5 py-4 text-white">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">Paramètres</div>
            <h3 className="mt-1 text-base font-extrabold">Accès aux modules</h3>
            <div className="mt-0.5 text-xs text-white/80">
              Qui voit chaque module dans le menu. Administrateurs et super users voient toujours tout.
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-white/80 hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {error && <div className="m-4 rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{error}</div>}

        <div className="flex min-h-0 flex-1">
          <div className={`min-h-0 w-full overflow-y-auto border-r border-line md:w-[340px] md:shrink-0 ${selected ? "hidden md:block" : ""}`}>
            {CONFIGURABLE_MODULES.map((m) => {
              const rule = data?.rules[m.id];
              const restricted = !!rule && !rule.everyone;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`block w-full border-b border-line px-4 py-2.5 text-left hover:bg-hover ${m.id === selectedId ? "bg-sel-bg" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-bold text-ink">
                      {restricted ? <Lock size={12} className="text-warn" /> : <Users size={12} className="text-ink-4" />}
                      {m.label}
                    </span>
                    {!BUILT_MODULES.has(m.id) && <span className="shrink-0 text-[10px] font-semibold text-ink-4">à venir</span>}
                  </div>
                  <div className="truncate text-[11px] text-ink-4">{data ? describe(rule, poles) : "…"}</div>
                </button>
              );
            })}
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto p-5 ${selected ? "" : "hidden md:block"}`}>
            {selected && data ? (
              <>
                <button onClick={() => setSelectedId(null)} className="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-3 md:hidden">
                  <ChevronLeft size={14} /> Modules
                </button>
                <ModuleAccessEditor key={selected.id} moduleId={selected.id} moduleLabel={selected.label} data={data} onSaved={applySaved} />
              </>
            ) : (
              <p className="p-6 text-center text-sm text-ink-4">{data ? "Choisissez un module pour régler qui le voit." : "Chargement…"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
