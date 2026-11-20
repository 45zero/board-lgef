"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type PickerPerson = { id: string; name: string };

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Menu déroulant de personnes, avec recherche (on tape un nom, la liste se resserre ; Entrée choisit
 * la première). Plusieurs choix (membres du comité directeur à inviter : les personnes choisies sont
 * rappelées en petit sous le menu) ou un seul (technicien de la captation, avec une option « vide »).
 */
export function PersonPicker({
  people,
  selected,
  onChange,
  multiple = false,
  placeholder,
  noneLabel,
  emptyText = "Personne à proposer.",
}: {
  people: PickerPerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder: string;
  /** Choix unique : libellé de l'option « personne » (ex. « Laisser en attente »). */
  noneLabel?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = useMemo(() => {
    const q = fold(query.trim());
    return q ? people.filter((p) => fold(p.name).includes(q)) : people;
  }, [people, query]);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const pick = (id: string) => {
    if (multiple)
      onChange(
        selected.includes(id)
          ? selected.filter((x) => x !== id)
          : [...selected, id]
      );
    else {
      onChange(id ? [id] : []);
      setOpen(false);
    }
    setQuery("");
  };

  const label = multiple
    ? selected.length === 0
      ? placeholder
      : `${selected.length} personne${selected.length > 1 ? "s" : ""} choisie${
          selected.length > 1 ? "s" : ""
        }`
    : selected[0]
    ? nameOf(selected[0])
    : noneLabel ?? placeholder;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-btn border border-line bg-card px-3 py-2 text-left text-sm text-ink-2 hover:bg-hover"
      >
        <span
          className={`truncate ${
            selected.length ? "font-semibold text-ink" : "text-ink-3"
          }`}
        >
          {label}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-4 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-btn border border-line bg-card shadow-modal">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-ink-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (list[0]) pick(list[0].id);
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Taper un nom…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {!multiple && noneLabel && !query && (
              <button
                type="button"
                onClick={() => pick("")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-3 hover:bg-hover"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {selected.length === 0 && (
                    <Check size={12} className="text-navy" />
                  )}
                </span>
                {noneLabel}
              </button>
            )}
            {people.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-4">{emptyText}</p>
            )}
            {people.length > 0 && list.length === 0 && (
              <p className="px-3 py-2 text-xs text-ink-4">
                Aucun nom ne correspond.
              </p>
            )}
            {list.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover"
                >
                  {multiple ? (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on
                          ? "border-navy bg-navy text-white"
                          : "border-line-strong"
                      }`}
                    >
                      {on && <Check size={11} />}
                    </span>
                  ) : (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {on && <Check size={12} className="text-navy" />}
                    </span>
                  )}
                  <span
                    className={on ? "font-semibold text-ink" : "text-ink-2"}
                  >
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Plusieurs choix : rappel des personnes choisies, hors du menu — petit, discret, mais visible. */}
      {multiple && selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-0.5 rounded-full bg-card/80 py-0.5 pl-2 pr-0.5 text-[10.5px] font-medium text-ink-3 ring-1 ring-line"
            >
              {nameOf(id)}
              <button
                type="button"
                onClick={() => pick(id)}
                aria-label={`Retirer ${nameOf(id)}`}
                className="rounded-full p-0.5 text-ink-4 hover:bg-hover hover:text-ink"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
