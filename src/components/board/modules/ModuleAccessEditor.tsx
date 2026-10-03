"use client";

import { Toggle } from "@/components/board/Toggle";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X, EyeOff } from "lucide-react";
import { saveModuleRule, type ModuleAccessAdmin } from "@/app/actions/module-access";
import { unwrap } from "@/lib/board/actionResult";
import { defaultRule, GROUP_CHOICES, isElevated, ROLE_CHOICES, ruleMatches, type DirectoryPerson, type ModuleRule } from "@/lib/board/modules";
import { buildPoles } from "@/lib/board/poles";

const sectionTitle = "mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-4";
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${on ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

/** Choix de personnes (ajoutées / retirées) : pastilles + recherche dans l'annuaire. */
function PeoplePicker({
  ids,
  directory,
  onChange,
  placeholder,
  tone,
}: {
  ids: string[];
  directory: DirectoryPerson[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  tone: "good" | "bad";
}) {
  const [query, setQuery] = useState("");
  const byId = new Map(directory.map((p) => [p.id, p]));
  const q = normalize(query.trim());
  const matches = q
    ? directory.filter((p) => !ids.includes(p.id) && !isElevated(p.role) && normalize(`${p.name} ${p.email ?? ""}`).includes(q)).slice(0, 6)
    : [];
  return (
    <div className="space-y-1.5">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <span
              key={id}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === "good" ? "bg-good-bg text-good" : "bg-bad-bg text-bad"}`}
            >
              {byId.get(id)?.name ?? "Compte supprimé"}
              <button type="button" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label="Retirer">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-btn border border-line px-2.5 py-1.5">
        <Search size={12} className="text-ink-4" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-xs outline-none" />
      </div>
      {matches.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => {
            onChange([...ids, p.id]);
            setQuery("");
          }}
          className="block w-full truncate rounded-btn px-2 py-1 text-left text-xs text-ink-2 hover:bg-hover"
        >
          {p.name} <span className="text-ink-4">{p.email}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Règle d'accès d'un module : tout le monde, ou restreint (rôles, pôles, Couverture match,
 * statut), plus personnes ajoutées / retirées. Aperçu en direct de qui le voit.
 */
export function ModuleAccessEditor({
  moduleId,
  moduleLabel,
  data,
  onSaved,
}: {
  moduleId: string;
  moduleLabel: string;
  data: ModuleAccessAdmin;
  onSaved: (rule: ModuleRule) => void;
}) {
  const [rule, setRule] = useState<ModuleRule>(() => data.rules[moduleId] ?? defaultRule(moduleId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showAudience, setShowAudience] = useState(false);
  const poles = useMemo(() => buildPoles(data.specialties), [data.specialties]);

  const update = (patch: Partial<ModuleRule>) => {
    setRule((r) => ({ ...r, ...patch }));
    setSaved(false);
  };
  const toggleIn = (list: string[], values: string[]) => {
    const on = values.some((v) => list.includes(v));
    return on ? list.filter((v) => !values.includes(v)) : [...list, ...values.filter((v) => !list.includes(v))];
  };

  const audience = data.directory.filter((p) => !isElevated(p.role) && ruleMatches(rule, p));
  const elevatedCount = data.directory.filter((p) => isElevated(p.role)).length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrap(await saveModuleRule(rule));
      setSaved(true);
      onSaved(rule);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Masquer sans perdre la règle : pour présenter les modules petit à petit. */}
      <div className={`flex items-center justify-between gap-3 rounded-btn border-2 p-3 ${rule.hidden ? "border-warn bg-warn-bg" : "border-line"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <EyeOff size={14} /> Masqué — en préparation
          </div>
          <div className="text-[11px] text-ink-3">
            Retiré du rail, du dock et du mobile de tout le monde ; seuls les administrateurs et super users le voient. La règle ci-dessous est
            conservée pour le jour où il sera présenté.
          </div>
        </div>
        <Toggle on={rule.hidden} onClick={() => update({ hidden: !rule.hidden })} />
      </div>

      <div className={rule.hidden ? "pointer-events-none opacity-50" : ""}>
        <div className={sectionTitle}>Qui voit « {moduleLabel} »</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { everyone: true, label: "Tout le monde", hint: "Tous les comptes du board" },
            { everyone: false, label: "Restreint", hint: "Rôles, pôles, réseaux choisis" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => update({ everyone: o.everyone })}
              className={`rounded-btn border-2 px-2.5 py-1.5 text-left ${rule.everyone === o.everyone ? "border-navy bg-sel-bg" : "border-line hover:bg-hover"}`}
            >
              <div className="text-sm font-bold text-ink">{o.label}</div>
              <div className="text-[11px] text-ink-4">{o.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {!rule.everyone && (
        <>
          <div>
            <div className={sectionTitle}>Pôles</div>
            <div className="flex flex-wrap gap-1.5">
              {poles.map((p) => (
                <Chip key={p.key} on={p.slugs.some((s) => rule.specialtySlugs.includes(s))} onClick={() => update({ specialtySlugs: toggleIn(rule.specialtySlugs, p.slugs) })}>
                  {p.label}
                </Chip>
              ))}
            </div>
          </div>
          {(["Couverture match", "Statut"] as const).map((group) => (
            <div key={group}>
              <div className={sectionTitle}>{group}</div>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_CHOICES.filter((g) => g.group === group).map((g) => (
                  <Chip key={g.slug} on={rule.specialtySlugs.includes(g.slug)} onClick={() => update({ specialtySlugs: toggleIn(rule.specialtySlugs, [g.slug]) })}>
                    {g.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className={sectionTitle}>Rôles</div>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_CHOICES.map((r) => (
                <Chip key={r.id} on={rule.roles.includes(r.id)} onClick={() => update({ roles: toggleIn(rule.roles, [r.id]) })}>
                  {r.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className={sectionTitle}>Toujours ajoutés</div>
            <PeoplePicker
              ids={rule.includeUserIds}
              directory={data.directory}
              tone="good"
              placeholder="Ajouter une personne, même hors des critères…"
              onChange={(ids) => update({ includeUserIds: ids, excludeUserIds: rule.excludeUserIds.filter((x) => !ids.includes(x)) })}
            />
          </div>
        </>
      )}

      <div>
        <div className={sectionTitle}>Toujours retirés</div>
        <PeoplePicker
          ids={rule.excludeUserIds}
          directory={data.directory}
          tone="bad"
          placeholder="Retirer une personne, même si elle correspond…"
          onChange={(ids) => update({ excludeUserIds: ids, includeUserIds: rule.includeUserIds.filter((x) => !ids.includes(x)) })}
        />
      </div>

      <div className="rounded-btn bg-subtle px-3 py-2.5">
        <button type="button" onClick={() => setShowAudience((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm text-ink-2">
            <strong className="text-ink">{audience.length}</strong> personne{audience.length > 1 ? "s" : ""} voi{audience.length > 1 ? "ent" : "t"} ce module
            <span className="text-ink-4"> · + {elevatedCount} administrateurs et super users (toujours)</span>
          </span>
          <ChevronDown size={14} className={`shrink-0 text-ink-4 transition-transform ${showAudience ? "rotate-180" : ""}`} />
        </button>
        {showAudience && (
          <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {audience.length === 0 && <span className="text-xs text-ink-4">Personne en dehors des administrateurs.</span>}
            {audience.map((p) => (
              <span key={p.id} className="rounded-full bg-card px-2 py-0.5 text-[11px] text-ink-2">
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && !busy && (
          <span className="flex items-center gap-1 text-xs font-semibold text-good">
            <Check size={12} /> Enregistré
          </span>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-btn bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-600 disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
