"use client";

import { useState } from "react";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { MobileBottomNav, type MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { MobileCalendrierScreen } from "@/components/board/mobile/screens/MobileCalendrierScreen";

const TITLES: Record<MobileTab, { title: string; kicker: string }> = {
  calendrier: { title: "Calendrier", kicker: "EVENEMENTS" },
  accueil: { title: "Dashboard", kicker: "ESPACE DE TRAVAIL" },
  mails: { title: "Mails", kicker: "MESSAGERIE" },
  trello: { title: "Trello", kicker: "TABLEAUX" },
};

/** Coque mobile — même app Next.js, bascule vers cette coque sous ~768px (voir useIsMobile). */
export function MobileShell() {
  const [tab, setTab] = useState<MobileTab>("calendrier");
  const [punchedIn, setPunchedIn] = useState(false);

  const { title, kicker } = TITLES[tab];

  return (
    <div className="flex h-screen flex-col bg-shell">
      <MobileHeader title={title} kicker={kicker} />

      <main className="flex-1 overflow-hidden">
        {tab === "calendrier" ? (
          <MobileCalendrierScreen />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-3">
            Module « {title} » — bientôt sur mobile
          </div>
        )}
      </main>

      <MobileBottomNav
        active={tab}
        onSelect={setTab}
        centerActive={punchedIn}
        onCenterPress={() => setPunchedIn((p) => !p)}
      />
    </div>
  );
}
