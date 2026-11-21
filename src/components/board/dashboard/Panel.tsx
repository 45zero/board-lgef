import type { ReactNode } from "react";

/** Panneau du tableau de bord : fond carte, bord fin, ombre douce. */
export const PANEL = "rounded-panel border border-line bg-card p-3 shadow-card";

/** Titre de panneau : pastille d'icône, titre, compteur rouge, filtres éventuels au milieu, action à droite. */
export function PanelHead({
  icon,
  title,
  count,
  middle,
  right,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  middle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 className={`flex items-center gap-2 text-[13px] font-extrabold text-ink md:text-sm ${middle ? "shrink-0" : "min-w-0"}`}>
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy text-white">
          {icon}
          {!!count && (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[9px] font-extrabold leading-none text-white ring-2 ring-card">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </span>
        <span className="truncate">{title}</span>
      </h2>
      {middle && <div className="min-w-0 flex-1">{middle}</div>}
      {right}
    </div>
  );
}
