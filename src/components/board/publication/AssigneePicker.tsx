"use client";

// Personne chargée de publier une publication (vidéo, album…) : petit menu dans l'onglet Fichiers d'un
// événement et sur les cartes du centre de publication (actions/publication-assignee.ts).

import { useEffect, useState } from "react";
import { Loader2, UserRound, Video } from "lucide-react";
import { assignPublication, getEventPublisher, listPublicationAssignees, setEventPublisher, type AssigneeOption } from "@/app/actions/publication-assignee";

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

type AssignResult = { ok: true } | { ok: false; error: string };

export function AssigneePicker({
  pubId,
  assign,
  value,
  onChanged,
  className = "",
}: {
  /** Publication à attribuer ; ou `assign` pour un autre enregistrement (événement). */
  pubId?: string;
  assign?: (next: string | null) => Promise<AssignResult>;
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
    const save = assign ?? ((n: string | null) => assignPublication(pubId!, n) as Promise<AssignResult>);
    const res = await save(next).catch((): AssignResult => ({ ok: false, error: "Attribution impossible pour le moment." }));
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

/**
 * « Publication : à publier par … » sur l'événement — choisi à tout moment, même sans vidéo ni
 * captation acceptée ; les vidéos déposées ensuite sont attribuées à cette personne.
 */
export function EventPublisherField({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  // Liste vide = pas le droit de publier (Paramètres → Publication) : la ligne n'apparaît pas.
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadOptions().then((o) => {
      if (cancelled || !o.length) return;
      setAllowed(true);
      void getEventPublisher(eventId)
        .then((r) => !cancelled && setValue(r.ok ? r.data : null))
        .catch(() => !cancelled && setValue(null));
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  if (!allowed || value === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-btn bg-panel px-2.5 py-2">
      <span className="flex items-center gap-1 text-xs font-semibold text-ink-2">
        <Video size={13} className="text-ink-3" /> Vidéos de l&rsquo;événement
      </span>
      <AssigneePicker value={value} assign={(next) => setEventPublisher(eventId, next) as Promise<AssignResult>}
        onChanged={(next) => {
          setValue(next);
          onChanged?.();
        }}
      />
    </div>
  );
}
