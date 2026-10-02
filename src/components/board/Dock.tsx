"use client";

import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";
import { useAppBadges, type AppBadge } from "@/hooks/board/useAppBadges";
import { AppBadgePills } from "@/components/board/AppBadgePills";
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
  Map as MapIcon,
  Camera,
} from "lucide-react";

const ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  accueil: Home,
  mails: Mail,
  trello: Kanban,
  planning: ArrowLeftRight,
  calendrier: Calendar,
  weekend: Camera,
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
  cartographie: MapIcon,
};

const PINNED = [
  "accueil",
  "mails",
  "trello",
  "planning",
  "calendrier",
  "weekend",
  "quiz",
  "pointage",
  "formations",
  "arbitrage",
  "ged",
  "drive",
  "inscription",
  "cartographie",
  "compta",
  "audiovisuel",
  "communication",
];


function DockTile({
  icon: Icon,
  active,
  badges,
  onClick,
  label,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  badges?: AppBadge[];
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
        <AppBadgePills badges={badges} className="absolute -right-1.5 -top-1.5" />
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
  const badges = useAppBadges();
  const visible = useVisibleModules();
  return (
    <div className="mx-auto mb-4 flex w-fit items-end gap-2">
      {PINNED.filter((id) => canShowModule(visible, id)).map((id) => (
        <DockTile
          key={id}
          icon={ICONS[id] ?? Home}
          active={id === activeApp}
          badges={badges[id]}
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
