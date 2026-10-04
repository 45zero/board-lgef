"use client";

import Image from "next/image";
import { ChevronDown, Settings } from "lucide-react";
import { NotificationBell } from "@/components/board/live/NotificationBell";
import { SupportButton } from "@/components/board/support/SupportButton";

/** `onLogoClick` : sur la page Mails, le logo ouvre le menu comptes / dossiers (d'où le chevron). */
export function MobileHeader({
  title,
  kicker,
  onLogoClick,
  menuOpen = false,
  onSettings,
  app = null,
}: {
  title: string;
  kicker: string;
  onLogoClick?: () => void;
  menuOpen?: boolean;
  /** Roue crantée : feuille Paramètres (bouton central…). */
  onSettings?: () => void;
  /** Module affiché, joint aux signalements du centre d'aide. */
  app?: string | null;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 pb-4 pt-[calc(env(safe-area-inset-top)+12px)] text-white"
      style={{ background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-500) 100%)" }}
    >
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

      <div className="flex items-center gap-1.5">
        <button onClick={onSettings} className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 hover:bg-white/10" aria-label="Paramètres">
          <Settings size={17} />
        </button>
        <SupportButton app={app} variant="mobile" />
        <NotificationBell variant="mobile" />
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red text-xs font-bold text-white">
          GV
        </div>
      </div>
    </div>
  );
}
