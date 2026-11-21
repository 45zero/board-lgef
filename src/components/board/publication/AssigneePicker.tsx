"use client";

// Personne chargée de publier une publication (vidéo, album…) : petit menu dans l'onglet Fichiers d'un
// événement et sur les cartes du centre de publication (actions/publication-assignee.ts).

import { useEffect, useState } from "react";
import { Loader2, UserRound } from "lucide-react";
import { assignPublication, listPublicationAssignees, type AssigneeOption } from "@/app/actions/publication-assignee";

// Liste chargée une fois par page, partagée par tous les menus.
let cached: Promise<AssigneeOption[]> | null = null;
function loadOptions() {
  cached ??= listPublicationAssignees()
    .then((r) => (r.ok ? r.data : []))
    .catch(() => {
      cached = null;
      return [];
    });
  return cached;
}

export function AssigneePicker({
  pubId,
  value,
  onChanged,
  className = "",
}: {
  pubId: string;
  value: string | null | undefined;
  onChanged?: (assigneeId: string | null) => void;
  className?: string;
}) {
  const [options, setOptions] = useState<AssigneeOption[] | null>(null);
  const [current, setCurrent] = useState<string | null>(value ?? null);
  const [busy, setBusy] = useState(false);

  // Valeur rechargée par le parent (liste rafraîchie) : on la reprend.
  const [seen, setSeen] = useState(value ?? null);
  if ((value ?? null) !== seen) {
    setSeen(value ?? null);
    setCurrent(value ?? null);
  }
  useEffect(() => {
    let cancelled = false;
    void loadOptions().then((o) => !cancelled && setOptions(o));
    return () => {
      cancelled = true;
    };
  }, []);

  // Pas encore de liste (migration absente ou personne) : rien à afficher.
  if (options && !options.length) return null;

  const change = async (next: string | null) => {
    const previous = current;
    setCurrent(next);
    setBusy(true);
    const res = await assignPublication(pubId, next).catch(() => ({ ok: false as const, error: "Attribution impossible pour le moment." }));
    setBusy(false);
    if (!res.ok) {
      setCurrent(previous);
      alert(res.error);
      return;
    }
    onChanged?.(next);
  };

  return (
    <label
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${
        current ? "border-link/40 bg-sel-bg text-navy" : "border-line bg-card text-ink-3"
      } ${className}`}
      title="Personne chargée de publier"
      onClick={(e) => e.stopPropagation()}
    >
      {busy ? <Loader2 size={11} className="shrink-0 animate-spin" /> : <UserRound size={11} className="shrink-0" />}
      <span className="shrink-0">À publier par</span>
      <select
        value={current ?? ""}
        disabled={!options || busy}
        onChange={(e) => void change(e.target.value || null)}
        className="min-w-0 max-w-[10rem] truncate bg-transparent font-bold outline-none"
        aria-label="Personne chargée de publier"
      >
        <option value="">Personne en particulier</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {current && options && !options.some((o) => o.id === current) && <option value={current}>Personne sans accès</option>}
      </select>
    </label>
  );
}
