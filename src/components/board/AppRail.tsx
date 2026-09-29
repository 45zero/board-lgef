"use client";

import { useCanPublish } from "@/hooks/board/useCanPublish";
import { useAppBadges } from "@/hooks/board/useAppBadges";
import { AppBadgePills } from "@/components/board/AppBadgePills";
import type { ComponentType } from "react";
import {
  Home,
  Mail,
  Kanban,
  CalendarRange,
  Calendar,
  Gamepad2,
  Clock,
  GraduationCap,
  Shield,
  FolderArchive,
  Calculator,
  Video,
  Megaphone,
  ShieldCheck,
  List,
  LayoutGrid,
  HardDrive,
  ClipboardCheck,
  Map as MapIcon,
  Receipt,
  Camera,
} from "lucide-react";
import { BOARD_APPS } from "@/lib/board/tokens";
import type { NavLayout } from "./BoardShell";

const APP_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  frais: Receipt,
  accueil: Home,
  mails: Mail,
  trello: Kanban,
  planning: CalendarRange,
  calendrier: Calendar,
  weekend: Camera,
  quiz: Gamepad2,
  pointage: Clock,
  formations: GraduationCap,
  arbitrage: Shield,
  ged: FolderArchive,
  drive: HardDrive,
  compta: Calculator,
  audiovisuel: Video,
  communication: Megaphone,
  administration: ShieldCheck,
  inscription: ClipboardCheck,
  cartographie: MapIcon,
};


export function AppRail({
  nav,
  activeApp,
  onSelectApp,
  onToggleNav,
}: {
  nav: NavLayout;
  activeApp: string;
  onSelectApp: (id: string) => void;
  onToggleNav: (nav: NavLayout) => void;
}) {
  // Compteurs réels (mails non lus, à publier, inscriptions…) — voir /api/badges.
  const badges = useAppBadges();
  const canPublish = useCanPublish();
  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col justify-between gap-2 rounded-panel border border-line bg-card/70 py-3 shadow-bar backdrop-blur ${
        nav === "rail" ? "w-[74px] items-center" : "w-[220px]"
      }`}
    >
      {/* Liste des applications défilante : le rail reste utilisable quel que soit le nombre d'applis. */}
      <div
        className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pt-1.5 [scrollbar-width:thin] ${
          nav === "rail" ? "w-full items-center" : "px-2"
        }`}
      >
        <button
          type="button"
          onClick={() => onToggleNav(nav === "rail" ? "list" : "rail")}
          className="mb-2 flex h-9 w-9 items-center justify-center self-center rounded-btn text-ink-3 hover:bg-hover"
          aria-label="Changer la disposition du rail"
        >
          {nav === "rail" ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>

        {BOARD_APPS.filter((item) => item.id !== "audiovisuel" || canPublish).map((item) => {
          const Icon = APP_ICONS[item.id] ?? Home;
          const isActive = item.id === activeApp;
          const itemBadges = badges[item.id];
          return (
            <button
              key={item.id}
              type="button"
              title={[item.label, ...(itemBadges ?? []).map((b) => b.title)].join(" — ")}
              onClick={() => onSelectApp(item.id)}
              className={`group relative flex items-center rounded-btn transition-colors ${
                nav === "rail" ? "h-[50px] w-[50px] justify-center" : "gap-3 px-3 py-2.5"
              } ${
                isActive
                  ? "bg-navy text-white"
                  : "text-ink-2 hover:bg-hover"
              }`}
            >
              <Icon size={18} />
              {nav === "list" && <span className="text-sm font-semibold">{item.label}</span>}
              <AppBadgePills
                badges={itemBadges}
                className={`absolute ${nav === "rail" ? "-right-1 -top-1" : "right-2 top-1/2 -translate-y-1/2"}`}
              />
            </button>
          );
        })}
      </div>

      <div className={`${nav === "rail" ? "w-[50px]" : "mx-2"} rounded-btn bg-subtle p-2 text-center`}>
        <div className="font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">Migration</div>
        {nav === "list" && <div className="mt-0.5 text-[11px] font-bold text-ink-2">7 / 14 apps</div>}
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-track">
          <div className="h-full w-1/2 rounded-full bg-red" />
        </div>
      </div>
    </aside>
  );
}
