"use client";

import { useAppLabel } from "@/hooks/board/useFraisFlavor";
import { useState } from "react";
import Image from "next/image";
import { Search, Moon, Sun, ChevronRight, Settings, Lock } from "lucide-react";
import { NotificationBell } from "@/components/board/live/NotificationBell";
import { SupportButton } from "@/components/board/support/SupportButton";
import type { BoardApp } from "@/lib/board/tokens";
import type { Theme } from "./BoardShell";
import { MyProfileModal } from "@/components/board/profile/MyProfileModal";
import { useCurrentProfile } from "@/hooks/board/useCurrentProfile";

export function TopBar({
  currentApp,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenModuleAccess,
}: {
  currentApp: BoardApp;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  /** Administrateurs : régler qui voit le module ouvert. */
  onOpenModuleAccess?: () => void;
}) {
  const { name, initials, avatarUrl } = useCurrentProfile();
  const [profileOpen, setProfileOpen] = useState(false);
  const { label: appLabel, kicker: appKicker } = useAppLabel()(currentApp);

  return (
    <>
      {/* relative z-40 : le backdrop-blur crée un contexte d'empilement — sans z-index, le volet des notifications passerait sous le contenu. */}
      <header className="relative z-40 mx-4 mt-4 flex h-[62px] items-center gap-4 rounded-btn border border-line bg-card/80 px-4 shadow-bar backdrop-blur">
        <div className="flex items-center gap-2">
          <Image src="/lgef-logo.png" alt="Ligue Grand Est de Football" width={34} height={34} className="rounded-lg" />

          <div className="leading-tight">
            <div className="text-sm font-extrabold text-ink">Board LGEF</div>
            <div className="font-mono text-[9px] tracking-[0.12em] text-ink-4 uppercase">
              Espace de travail
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          {appLabel}
          <ChevronRight size={11} className="text-ink-4" />
          <span className="text-ink-3">{appKicker}</span>
          {onOpenModuleAccess && (
            <button
              onClick={onOpenModuleAccess}
              title={`Qui voit « ${appLabel} »`}
              aria-label={`Accès au module ${appLabel}`}
              className="ml-1 rounded-full p-0.5 text-ink-4 hover:bg-hover hover:text-ink"
            >
              <Lock size={11} />
            </button>
          )}
        </div>

        <div className="ml-2 flex flex-1 items-center gap-2 rounded-btn border border-line bg-subtle px-3 py-2 text-ink-3">
          <Search size={16} />
          <input
            placeholder="Rechercher, créer, lancer une commande..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-4"
          />
          <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-ink-4">
            ⌘K
          </kbd>
        </div>

        <SupportButton app={currentApp.id} />

        <NotificationBell />

        <button
          type="button"
          onClick={onToggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
          aria-label="Changer de thème"
        >
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-2 hover:bg-hover"
          aria-label="Paramètres du board"
        >
          <Settings size={16} />
        </button>

        <button type="button" onClick={() => setProfileOpen(true)} className="flex items-center gap-2 rounded-full pr-1 hover:bg-hover" title="Mon profil">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo du bucket Supabase, domaine non déclaré à next/image
            <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red text-xs font-bold text-white">{initials || "?"}</span>
          )}
          {name && <span className="hidden text-sm font-semibold text-ink-2 lg:inline">{name}</span>}
        </button>
      </header>
      {/* Hors du header : son backdrop-blur piégerait la fenêtre (position fixed). */}
      {profileOpen && <MyProfileModal onClose={() => setProfileOpen(false)} />}
    </>
  );
}
