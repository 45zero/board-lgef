"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Search, Moon, Sun, ChevronRight, Settings, Lock } from "lucide-react";
import { NotificationBell } from "@/components/board/live/NotificationBell";
import { SupportButton } from "@/components/board/support/SupportButton";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { BoardApp } from "@/lib/board/tokens";
import type { Theme } from "./BoardShell";
import { MyProfileModal } from "@/components/board/profile/MyProfileModal";
import { PROFILE_UPDATED_EVENT } from "@/lib/board/profile";

function useCurrentProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ firstName: string; lastName: string; avatarUrl: string | null } | null>(null);
  // Relu quand « Mon profil » enregistre un changement (nom, photo).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(PROFILE_UPDATED_EVENT, bump);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on logout, no async fetch involved
      setProfile(null);
      return;
    }
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setProfile({ firstName: data?.first_name ?? "", lastName: data?.last_name ?? "", avatarUrl: data?.avatar_url ?? null });
      });
  }, [user?.id, version]);

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";
  const initials =
    [profile?.firstName?.[0], profile?.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    name.slice(0, 2).toUpperCase();

  return { name, initials, avatarUrl: profile?.avatarUrl ?? null };
}

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

  return (
    <>
      <header className="mx-4 mt-4 flex h-[62px] items-center gap-4 rounded-btn border border-line bg-card/80 px-4 shadow-bar backdrop-blur">
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
          {currentApp.label}
          <ChevronRight size={11} className="text-ink-4" />
          <span className="text-ink-3">{currentApp.kicker}</span>
          {onOpenModuleAccess && (
            <button
              onClick={onOpenModuleAccess}
              title={`Qui voit « ${currentApp.label} »`}
              aria-label={`Accès au module ${currentApp.label}`}
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
