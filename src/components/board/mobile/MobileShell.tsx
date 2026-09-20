"use client";

import { useState } from "react";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { MobileBottomNav, type MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { MobileCalendrierScreen } from "@/components/board/mobile/screens/MobileCalendrierScreen";
import { MobileMailsScreen } from "@/components/board/mobile/screens/MobileMailsScreen";

const TITLES: Record<MobileTab, { title: string; kicker: string }> = {
  calendrier: { title: "Calendrier", kicker: "EVENEMENTS" },
  accueil: { title: "Dashboard", kicker: "ESPACE DE TRAVAIL" },
  mails: { title: "Mails", kicker: "MESSAGERIE" },
  trello: { title: "Trello", kicker: "TABLEAUX" },
};

/** Coque mobile — même app Next.js, bascule vers cette coque sous ~768px (voir useIsMobile). */
export function MobileShell() {
  const [tab, setTab] = useState<MobileTab>("calendrier");
  const [toast, setToast] = useState(false);

  const { title, kicker } = TITLES[tab];

  const handleCenterPress = () => {
    // Capture de frais (scan de justificatif) — pas encore construite ; le
    // bouton central configurable (§6.3 du handoff) non plus.
    setToast(true);
    setTimeout(() => setToast(false), 2200);
  };

  return (
    <div className="relative flex h-dvh flex-col bg-shell">
      <MobileHeader title={title} kicker={kicker} />

      <main className="flex-1 overflow-hidden">
        {tab === "calendrier" ? (
          <MobileCalendrierScreen />
        ) : tab === "mails" ? (
          <MobileMailsScreen />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-3">
            Module « {title} » — bientôt sur mobile
          </div>
        )}
      </main>

      {toast && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-modal">
          Capture de frais — bientôt disponible
        </div>
      )}

      <MobileBottomNav active={tab} onSelect={setTab} onCenterPress={handleCenterPress} />
    </div>
  );
}
