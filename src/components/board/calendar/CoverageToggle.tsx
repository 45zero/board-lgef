"use client";

import type { ComponentType } from "react";
import { DefaultMenu } from "@/components/board/calendar/DefaultMenu";

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
  return (
    <DefaultMenu
      title={`Matchs couverts ${label}`}
      options={[
        { label: "Afficher par défaut", selected: isDefault, onSelect: () => onSetDefault(true) },
        { label: "Masquer par défaut", selected: !isDefault, onSelect: () => onSetDefault(false) },
      ]}
    >
      {(onContextMenu) => (
        <button
          onClick={onToggle}
          onContextMenu={onContextMenu}
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-btn border ${
            on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-3 hover:bg-hover"
          }`}
          title={`${on ? `Matchs du week-end ${label} affichés — les masquer` : `Afficher les matchs du week-end couverts ${label}`} · clic droit : affichage par défaut (${isDefault ? "affichés" : "masqués"})`}
          aria-label={`Matchs du week-end couverts ${label}`}
          aria-pressed={on}
        >
          <Icon size={15} />
        </button>
      )}
    </DefaultMenu>
  );
}
