"use client";

import { canShowModule, useHiddenModules, useVisibleModules } from "@/hooks/board/useVisibleModules";
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
  Wallet,
  Camera,
  EyeOff,
} from "lucide-react";
import { BOARD_APPS } from "@/lib/board/tokens";
import type { NavLayout } from "./BoardShell";

const APP_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  frais: Receipt,
  effectif: Wallet,
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
  const visible = useVisibleModules();
  const hidden = useHiddenModules();
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

        {BOARD_APPS.filter((item) => canShowModule(visible, item.id)).map((item) => {
          const Icon = APP_ICONS[item.id] ?? Home;
          const isActive = item.id === activeApp;
          const itemBadges = badges[item.id];
          return (
            <button
              key={item.id}
              type="button"
              title={[item.label, ...(hidden.has(item.id) ? ["masqué : visible seulement des administrateurs"] : []), ...(itemBadges ?? []).map((b) => b.title)].join(" — ")}
              onClick={() => onSelectApp(item.id)}
              className={`group relative flex items-center rounded-btn transition-colors ${
                nav === "rail" ? "h-[50px] w-[50px] justify-center" : "gap-3 px-3 py-2.5"
              } ${
                isActive
                  ? "bg-navy text-white"
                  : "text-ink-2 hover:bg-hover"
              }`}
            >
              <span className={hidden.has(item.id) ? "opacity-50" : ""}>
                <Icon size={18} />
              </span>
              {nav === "list" && <span className={`text-sm font-semibold ${hidden.has(item.id) ? "opacity-60" : ""}`}>{item.label}</span>}
              {hidden.has(item.id) && (
                <EyeOff size={10} className={`absolute ${nav === "rail" ? "bottom-1 right-1" : "right-2 top-1/2 -translate-y-1/2"} ${isActive ? "text-white" : "text-warn"}`} />
              )}
              <AppBadgePills
                badges={itemBadges}
                className={`absolute ${nav === "rail" ? "-right-1 -top-1" : "right-2 top-1/2 -translate-y-1/2"}`}
              />
            </button>
          );
        })}
      </div>

    </aside>
  );
}
