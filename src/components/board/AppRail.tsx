"use client";

import { canShowModule, useHiddenModules, useVisibleModules } from "@/hooks/board/useVisibleModules";
import { useAppBadges } from "@/hooks/board/useAppBadges";
import { AppBadgePills } from "@/components/board/AppBadgePills";
import type { ComponentType } from "react";
import Image from "next/image";
import {
  Home,
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
  ClipboardCheck,
  Map as MapIcon,
  Receipt,
  Wallet,
  Camera,
  EyeOff,
  Send,
  Sprout,
  Trophy,
} from "lucide-react";
import { useAppLabel } from "@/hooks/board/useFraisFlavor";
import { BOARD_APPS } from "@/lib/board/tokens";
import { MailBrandIcon } from "@/components/board/mail/MailBrandIcon";
import { DriveBrandIcon } from "@/components/board/DriveBrandIcon";
import type { NavLayout } from "./BoardShell";

const APP_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  frais: Receipt,
  effectif: Wallet,
  accueil: Home,
  mails: MailBrandIcon,
  trello: Kanban,
  planning: CalendarRange,
  calendrier: Calendar,
  weekend: Camera,
  quiz: Gamepad2,
  pointage: Clock,
  formations: GraduationCap,
  arbitrage: Shield,
  ged: FolderArchive,
  drive: DriveBrandIcon,
  transfer: Send,
  compta: Calculator,
  audiovisuel: Video,
  communication: Megaphone,
  administration: ShieldCheck,
  inscription: ClipboardCheck,
  cartographie: MapIcon,
  fief: Sprout,
  tournois: Trophy,
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
  const labelOf = useAppLabel();
  return (
    <aside
      className={`flex min-h-0 shrink-0 flex-col justify-between gap-2 border-r border-line bg-card/70 pb-3 shadow-bar backdrop-blur ${
        nav === "rail" ? "w-[74px] items-center" : "w-[220px]"
      }`}
    >
      {/* Le rail monte jusqu'en haut de l'écran : logo et nom de la Ligue en tête. Hauteur calée sur la
          barre du haut (62 px) : le trait sous le logo prolonge le bas de la barre. */}
      <div className={`flex h-[62px] shrink-0 items-center border-b border-line ${nav === "rail" ? "w-full flex-col justify-center gap-0.5 px-1" : "gap-2.5 px-4"}`}>
        <Image src="/lgef-logo.png" alt="Ligue du Grand Est de Football" width={nav === "rail" ? 30 : 36} height={nav === "rail" ? 30 : 36} className="shrink-0 rounded-lg" />
        {nav === "rail" ? (
          <span className="text-center text-[7px] font-extrabold uppercase leading-[1.15] tracking-wide text-ink-2">Ligue du Grand Est</span>
        ) : (
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-extrabold text-ink">Ligue du Grand Est</span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-ink-4">de Football</span>
          </span>
        )}
      </div>

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
              title={[labelOf(item).label, ...(hidden.has(item.id) ? ["masqué : visible seulement des administrateurs"] : []), ...(itemBadges ?? []).map((b) => b.title)].join(" — ")}
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
              {nav === "list" && <span className={`text-sm font-semibold ${hidden.has(item.id) ? "opacity-60" : ""}`}>{labelOf(item).label}</span>}
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
