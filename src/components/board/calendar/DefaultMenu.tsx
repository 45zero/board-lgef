"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

export type DefaultOption = { label: string; selected: boolean; onSelect: () => void; /** Précision sous le libellé. */ hint?: string };

/**
 * Menu du clic droit « affichage par défaut » des contrôles du calendrier (bonhomme, couvertures,
 * vues). `children` reçoit le gestionnaire à poser en onContextMenu sur le ou les boutons.
 */
export function DefaultMenu({
  title,
  options,
  footnote = "Le clic simple change l'affichage pour cette session seulement.",
  atCursor = false,
  className = "relative",
  children,
}: {
  title: string;
  options: DefaultOption[];
  /** `null` : pas de note en bas du menu. */
  footnote?: string | null;
  /** Menu posé au curseur (position fixe) : pas coupé par une colonne qui défile (volets latéraux). */
  atCursor?: boolean;
  className?: string;
  /** `openAt` : ouvrir le menu à une position (bouton visible, appui long sur mobile). */
  children: (onContextMenu: (e: React.MouseEvent) => void, openAt: (x: number, y: number) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // 256 px de large, ~200 de haut : gardé dans la fenêtre.
  const openAt = (x: number, y: number) => {
    setAt({ x: Math.max(8, Math.min(x, window.innerWidth - 264)), y: Math.max(8, Math.min(y, window.innerHeight - 220)) });
    setOpen(true);
  };

  return (
    <div ref={ref} className={className}>
      {children((e) => {
        e.preventDefault();
        openAt(e.clientX, e.clientY);
      }, openAt)}
      {open && (
        <div
          className={`${atCursor && at ? "fixed z-[80]" : "absolute right-0 top-full z-30 mt-1.5"} w-64 rounded-card border border-line bg-card p-1.5 text-left shadow-card`}
          style={atCursor && at ? { left: at.x, top: at.y } : undefined}
        >
          <p className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">{title}</p>
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                o.onSelect();
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover"
            >
              <span className="mt-0.5 w-4 shrink-0">{o.selected && <Check size={14} className="text-good" />}</span>
              <span className="min-w-0">
                {o.label}
                {o.hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-4">{o.hint}</span>}
              </span>
            </button>
          ))}
          {footnote !== null && (
            <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-ink-4">{footnote} Le réglage par défaut suit votre compte, sur ordinateur comme sur mobile.</p>
          )}
        </div>
      )}
    </div>
  );
}
