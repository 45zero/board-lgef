"use client";

import type { ComponentType } from "react";
import {
  Home,
  Mail,
  Kanban,
  ArrowLeftRight,
  Calendar,
  Gamepad2,
  Clock,
  GraduationCap,
  Flag,
  FolderArchive,
  Calculator,
  Video,
  Volume2,
  Sun,
  Plus,
  HardDrive,
  ClipboardCheck,
} from "lucide-react";

const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  accueil: Home,
  mails: Mail,
  trello: Kanban,
  planning: ArrowLeftRight,
  calendrier: Calendar,
  quiz: Gamepad2,
  pointage: Clock,
  formations: GraduationCap,
  arbitrage: Flag,
  ged: FolderArchive,
  drive: HardDrive,
  compta: Calculator,
  audiovisuel: Video,
  communication: Volume2,
  inscription: ClipboardCheck,
};

const PINNED = [
  "accueil",
  "mails",
  "trello",
  "planning",
  "calendrier",
  "quiz",
  "pointage",
  "formations",
  "arbitrage",
  "ged",
  "drive",
  "inscription",
  "compta",
  "audiovisuel",
  "communication",
];

/** Aucun système de comptage de notifications réel n'existe encore par app — valeurs de démo, cohérentes avec le reste de la maquette (ContextPanel). */
const BADGES: Partial<Record<string, number>> = {
  mails: 12,
  trello: 5,
  calendrier: 7,
  quiz: 1,
};

function DockTile({
  icon: Icon,
  active,
  badge,
  onClick,
  label,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  badge?: number;
  onClick: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active}
        className={`group relative flex h-[52px] w-[52px] items-center justify-center rounded-2xl shadow-card transition-transform hover:scale-105 ${
          active ? "bg-navy" : "bg-card"
        }`}
      >
        <Icon size={20} className={active ? "text-white" : "text-ink-2"} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-white ring-2 ring-shell">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
      <span className="h-1 w-1 rounded-full bg-ink-4/40" />
    </div>
  );
}

export function Dock({
  activeApp,
  onSelectApp,
  theme,
  onToggleTheme,
}: {
  activeApp: string;
  onSelectApp: (id: string) => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  return (
    <div className="mx-auto mb-4 flex w-fit items-end gap-2">
      {PINNED.map((id) => (
        <DockTile
          key={id}
          icon={ICONS[id] ?? Home}
          active={id === activeApp}
          badge={BADGES[id]}
          onClick={() => onSelectApp(id)}
          label={id}
        />
      ))}
      {onToggleTheme && (
        <DockTile icon={Sun} active={theme === "dark"} onClick={onToggleTheme} label="theme" />
      )}
      <DockTile icon={Plus} active={false} onClick={() => {}} label="plus" />
    </div>
  );
}
