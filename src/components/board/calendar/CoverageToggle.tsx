"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check } from "lucide-react";

/**
 * Bouton « matchs du week-end couverts en vidéo / en photo » du calendrier. Clic : afficher ou
 * masquer pour la session ; clic droit : choisir s'ils sont affichés par défaut.
 */
export function CoverageToggle({
  icon: Icon,
  label,
  on,
  isDefault,
  onToggle,
  onSetDefault,
}: {
  icon: ComponentType<{ size?: number }>;
  /** « en vidéo » / « en photo ». */
  label: string;
  on: boolean;
  isDefault: boolean;
  onToggle: () => void;
  onSetDefault: (on: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-btn border ${
          on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:bg-hover"
        }`}
        title={`${on ? `Matchs du week-end ${label} affichés — les masquer` : `Afficher les matchs du week-end couverts ${label}`} · clic droit : affichage par défaut (${isDefault ? "affichés" : "masqués"})`}
        aria-label={`Matchs du week-end couverts ${label}`}
        aria-pressed={on}
      >
        <Icon size={15} />
      </button>
      {menu && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-card border border-line bg-card p-1.5 shadow-card">
          <p className="px-2 pb-1 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Matchs couverts {label}</p>
          {[
            { value: true, text: "Afficher par défaut" },
            { value: false, text: "Masquer par défaut" },
          ].map((o) => (
            <button
              key={String(o.value)}
              onClick={() => {
                onSetDefault(o.value);
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover"
            >
              <span className="w-4">{isDefault === o.value && <Check size={14} className="text-good" />}</span>
              {o.text}
            </button>
          ))}
          <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-ink-4">Le clic simple affiche ou masque pour cette session seulement.</p>
        </div>
      )}
    </div>
  );
}
