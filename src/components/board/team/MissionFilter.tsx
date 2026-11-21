"use client";

import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Popover } from "@/components/board/team/TeamUi";

/**
 * « Cartes sans mission » sur le titre d'une liste : clic = masquer / afficher les cartes où je ne suis
 * pas assigné (le temps de la visite) ; clic droit = menu « Affichage par défaut » (retenu sur l'appareil).
 */
export function MissionFilter({
  hide,
  hideByDefault,
  onToggle,
  onMakeDefault,
}: {
  hide: boolean;
  hideByDefault: boolean;
  onToggle: () => void;
  onMakeDefault: (hide: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        aria-pressed={hide}
        title={`${hide ? "Cartes sans mission pour vous masquées — cliquer : les afficher" : "Cliquer : masquer les cartes où vous n'avez pas de mission"}. Clic droit : affichage par défaut (actuellement : ${hideByDefault ? "masquées" : "affichées"}).`}
        className={`flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${hide ? "bg-navy text-white" : "bg-subtle text-ink-3 hover:text-ink"}`}
      >
        {hide ? <EyeOff size={11} strokeWidth={2.5} /> : <Eye size={11} strokeWidth={2.5} />} Cartes sans mission
        {hideByDefault && <span className={`h-1 w-1 rounded-full ${hide ? "bg-white" : "bg-link"}`} aria-label="par défaut" />}
      </button>
      <Popover open={menu} onClose={() => setMenu(false)} align="right" width={250}>
        <p className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-4">Affichage par défaut</p>
        {[
          { value: false, label: "Toutes les cartes", Icon: Eye },
          { value: true, label: "Masquer les cartes sans mission", Icon: EyeOff },
        ].map(({ value, label, Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setMenu(false);
              onMakeDefault(value);
            }}
            className="flex w-full items-center gap-2 rounded-btn px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover"
          >
            <Icon size={13} className="text-ink-3" />
            <span className="flex-1">{label}</span>
            {hideByDefault === value && <Check size={14} className="text-good" />}
          </button>
        ))}
        <p className="px-2 pt-1 text-[10px] leading-snug text-ink-4">Retenu sur cet appareil, pour cette liste. Un clic sur le bouton change l&apos;affichage le temps de la visite.</p>
      </Popover>
    </span>
  );
}
