"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronLeft, Settings } from "lucide-react";
import { NotificationBell } from "@/components/board/live/NotificationBell";
import { SupportButton } from "@/components/board/support/SupportButton";
import { MyProfileModal } from "@/components/board/profile/MyProfileModal";
import { useCurrentProfile } from "@/hooks/board/useCurrentProfile";

/** `onLogoClick` : sur la page Mails, le logo ouvre le menu comptes / dossiers (d'où le chevron). */
export function MobileHeader({
  title,
  kicker,
  onLogoClick,
  menuOpen = false,
  onSettings,
  app = null,
  onBack,
  actions,
}: {
  title: string;
  kicker: string;
  onLogoClick?: () => void;
  menuOpen?: boolean;
  /** Roue crantée : feuille Paramètres (bouton central…). */
  onSettings?: () => void;
  /** Module affiché, joint aux signalements du centre d'aide. */
  app?: string | null;
  /** Flèche retour avant le logo (écrans ouverts par-dessus, ex. Frais). */
  onBack?: () => void;
  /** Boutons propres à l'écran, placés avant la roue crantée (ex. Photo / Joindre dans Frais). */
  actions?: React.ReactNode;
}) {
  const { initials, avatarUrl } = useCurrentProfile();
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <>
    <div
      className="flex items-center justify-between px-4 pb-4 pt-[calc(env(safe-area-inset-top)+12px)] text-white"
      style={{ background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-500) 100%)" }}
    >
      <div className="flex min-w-0 items-center gap-1">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Retour" className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10">
          <ChevronLeft size={22} />
        </button>
      )}
      <button
        type="button"
        onClick={onLogoClick}
        disabled={!onLogoClick}
        className="flex min-w-0 items-center gap-2.5 text-left"
        aria-label={onLogoClick ? "Comptes et dossiers" : undefined}
      >
        <Image src="/lgef-logo.png" alt="Ligue Grand Est de Football" width={30} height={30} className="rounded-btn" />
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[15px] font-extrabold leading-tight">
            {title}
            {onLogoClick && <ChevronDown size={15} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />}
          </div>
          <div className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">{kicker}</div>
        </div>
      </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        <button onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10" aria-label="Paramètres">
          <Settings size={17} />
        </button>
        <SupportButton app={app} variant="mobile" />
        <NotificationBell variant="mobile" />
        <button type="button" onClick={() => setProfileOpen(true)} className="shrink-0 rounded-full" aria-label="Mon profil">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo du bucket Supabase, domaine non déclaré à next/image
            <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red text-xs font-bold text-white">{initials || "?"}</span>
          )}
        </button>
      </div>
    </div>
    {profileOpen && <MyProfileModal onClose={() => setProfileOpen(false)} />}
    </>
  );
}
