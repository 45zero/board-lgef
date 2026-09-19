"use client";

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
} from "lucide-react";
import { BOARD_APPS } from "@/lib/board/tokens";
import type { NavLayout } from "./BoardShell";

const APP_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  accueil: Home,
  mails: Mail,
  trello: Kanban,
  planning: CalendarRange,
  calendrier: Calendar,
  quiz: Gamepad2,
  pointage: Clock,
  formations: GraduationCap,
  arbitrage: Shield,
  ged: FolderArchive,
  compta: Calculator,
  audiovisuel: Video,
  communication: Megaphone,
  administration: ShieldCheck,
};

const RUNNING_APPS = new Set(["accueil", "mails", "trello", "calendrier", "quiz", "pointage", "ged"]);

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
  return (
    <aside
      className={`flex shrink-0 flex-col justify-between rounded-panel border border-line bg-card/70 py-3 shadow-bar backdrop-blur ${
        nav === "rail" ? "w-[74px] items-center" : "w-[220px]"
      }`}
    >
      <div className={`flex flex-col gap-1 ${nav === "rail" ? "items-center" : "px-2"}`}>
        <button
          type="button"
          onClick={() => onToggleNav(nav === "rail" ? "list" : "rail")}
          className="mb-2 flex h-9 w-9 items-center justify-center self-center rounded-btn text-ink-3 hover:bg-hover"
          aria-label="Changer la disposition du rail"
        >
          {nav === "rail" ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>

        {BOARD_APPS.map((item) => {
          const Icon = APP_ICONS[item.id] ?? Home;
          const isActive = item.id === activeApp;
          const isRunning = RUNNING_APPS.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
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
              {isRunning && (
                <span
                  className={`absolute h-1.5 w-1.5 rounded-full bg-good ${
                    nav === "rail" ? "top-1.5 right-1.5" : "right-3 top-1/2 -translate-y-1/2"
                  }`}
                />
              )}
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
