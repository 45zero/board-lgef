"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { foldText, useDirectory, useFiefFunctions } from "@/components/fief/directory";
import { Avatar } from "@/components/fief/feed";
import { selCount, selLabel, type FiefAudienceSel } from "@/lib/fief/audience";

// Choix d'un public « Certaines personnes » (publication, document partagé) : des personnes, des
// fonctions (éducatrices, dirigeantes, joueuses…) et des clubs — une membre est visée si elle
// correspond à l'un des choix (règle fief_audience_match).

type Tab = "people" | "functions" | "clubs";

export function AudiencePicker({
  title = "Qui peut voir cette publication ?",
  excludeId,
  initial,
  onClose,
}: {
  title?: string;
  excludeId?: string;
  initial: FiefAudienceSel;
  onClose: (sel: FiefAudienceSel | null) => void;
}) {
  const people = useDirectory();
  const functions = useFiefFunctions();
  const [sel, setSel] = useState<FiefAudienceSel>(initial);
  const [tab, setTab] = useState<Tab>("people");
  const [q, setQ] = useState("");

  const clubs = useMemo(() => {
    const map = new Map<string, { number: string; name: string; count: number }>();
    for (const p of people ?? []) {
      if (!p.club_number) continue;
      const c = map.get(p.club_number) ?? { number: p.club_number, name: p.club_name ?? p.club_number, count: 0 };
      c.count += 1;
      map.set(p.club_number, c);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [people]);
  const fnCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of people ?? []) for (const f of p.functions ?? []) n.set(f, (n.get(f) ?? 0) + 1);
    return n;
  }, [people]);

  const needle = foldText(q.trim());
  const toggle = (key: keyof FiefAudienceSel, id: string) =>
    setSel((prev) => ({ ...prev, [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id] }));

  const row = (key: string, on: boolean, onClick: () => void, left: React.ReactNode, label: string, sub?: string | null) => (
    <button key={key} type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-f-subtle">
      {left}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {sub && <span className="block truncate text-xs text-f-muted">{sub}</span>}
      </span>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-f-accent bg-f-accent text-white" : "border-f-border-strong"}`}>
        {on && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
  const bubble = (text: string) => <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-f-subtle text-xs font-bold text-f-muted">{text}</span>;

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "people", label: "Personnes", n: sel.ids.length },
    { id: "functions", label: "Fonctions", n: sel.functions.length },
    { id: "clubs", label: "Clubs", n: sel.clubs.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => onClose(null)}>
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-f-surface text-f-text sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button onClick={() => onClose(null)} aria-label="Fermer" className="rounded-full p-1.5 hover:bg-f-subtle">
            <X size={20} />
          </button>
        </div>
        <div className="flex gap-1.5 px-5 pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setQ("");
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${tab === t.id ? "bg-f-accent text-white" : "bg-f-subtle text-f-text"}`}
            >
              {t.label}
              {t.n > 0 && ` (${t.n})`}
            </button>
          ))}
        </div>
        {tab !== "functions" && (
          <div className="px-5 pb-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-f-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === "people" ? "Nom ou club" : "Nom du club"}
                className="w-full rounded-xl bg-f-subtle py-2.5 pl-10 pr-3 text-[15px] outline-none"
              />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2">
          {people === null && <p className="px-3 py-4 text-sm text-f-muted">Chargement…</p>}
          {tab === "people" &&
            (people ?? [])
              .filter((p) => p.user_id !== excludeId && (!needle || foldText(`${p.first_name} ${p.last_name} ${p.club_name ?? ""}`).includes(needle)))
              .map((p) =>
                row(
                  p.user_id,
                  sel.ids.includes(p.user_id),
                  () => toggle("ids", p.user_id),
                  <Avatar author={{ id: p.user_id, team: false }} size={36} />,
                  `${p.first_name} ${p.last_name}`,
                  p.club_name
                )
              )}
          {tab === "functions" &&
            (functions ?? []).map((f) => {
              const n = fnCount.get(f.slug) ?? 0;
              return row(f.slug, sel.functions.includes(f.slug), () => toggle("functions", f.slug), bubble(f.label.slice(0, 2).toUpperCase()), f.label, `${n} membre${n > 1 ? "s" : ""}`);
            })}
          {tab === "clubs" &&
            (clubs.length ? (
              clubs
                .filter((c) => !needle || foldText(c.name).includes(needle))
                .map((c) => row(c.number, sel.clubs.includes(c.number), () => toggle("clubs", c.number), bubble(c.name.slice(0, 2).toUpperCase()), c.name, `${c.count} membre${c.count > 1 ? "s" : ""}`))
            ) : (
              <p className="px-3 py-4 text-sm text-f-muted">Aucun club parmi les membres.</p>
            ))}
        </div>
        <div className="flex items-center gap-3 border-t border-f-border px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <span className="min-w-0 truncate text-sm text-f-muted">{selCount(sel) ? selLabel(sel) : "Rien de choisi"}</span>
          <button onClick={() => onClose(sel)} className="ml-auto rounded-xl bg-f-accent px-4 py-2 text-sm font-bold text-white">
            Valider
          </button>
        </div>
      </div>
    </div>
  );
}
