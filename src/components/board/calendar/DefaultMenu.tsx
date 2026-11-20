"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

export type DefaultOption = { label: string; selected: boolean; onSelect: () => void };

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
  footnote?: string;
  /** Menu posé au curseur (position fixe) : pas coupé par une colonne qui défile (volets latéraux). */
  atCursor?: boolean;
  className?: string;
  children: (onContextMenu: (e: React.MouseEvent) => void) => ReactNode;
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

  return (
    <div ref={ref} className={className}>
      {children((e) => {
        e.preventDefault();
        // 256 px de large, ~200 de haut : gardé dans la fenêtre.
        setAt({ x: Math.max(8, Math.min(e.clientX, window.innerWidth - 264)), y: Math.max(8, Math.min(e.clientY, window.innerHeight - 220)) });
        setOpen(true);
      })}
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
              className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover"
            >
              <span className="w-4">{o.selected && <Check size={14} className="text-good" />}</span>
              {o.label}
            </button>
          ))}
          <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-ink-4">{footnote} Le réglage par défaut suit votre compte, sur ordinateur comme sur mobile.</p>
        </div>
      )}
    </div>
  );
}
