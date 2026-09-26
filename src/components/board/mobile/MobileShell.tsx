"use client";

import { useCallback, useState } from "react";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { MobileBottomNav, type MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { MobileCalendrierScreen } from "@/components/board/mobile/screens/MobileCalendrierScreen";
import { MobileMailsScreen } from "@/components/board/mobile/screens/MobileMailsScreen";
import { FraisScreen } from "@/components/board/screens/FraisScreen";
import { AccueilScreen } from "@/components/board/screens/AccueilScreen";

const TITLES: Record<MobileTab, { title: string; kicker: string }> = {
  calendrier: { title: "Calendrier", kicker: "EVENEMENTS" },
  accueil: { title: "Dashboard", kicker: "ESPACE DE TRAVAIL" },
  mails: { title: "Mails", kicker: "MESSAGERIE" },
  trello: { title: "Trello", kicker: "TABLEAUX" },
};

/** Coque mobile — même app Next.js, bascule vers cette coque sous ~768px (voir useIsMobile). */
export function MobileShell() {
  const [tab, setTab] = useState<MobileTab>("calendrier");
  const [mailMenuOpen, setMailMenuOpen] = useState(false);
  const [punchedIn, setPunchedIn] = useState(true);
  const [mailContext, setMailContext] = useState<string | null>(null);
  const closeMailMenu = useCallback(() => setMailMenuOpen(false), []);

  const { title } = TITLES[tab];
  const kicker = tab === "mails" && mailContext ? mailContext : TITLES[tab].kicker;

  const selectTab = (next: MobileTab) => {
    setMailMenuOpen(false);
    setTab(next);
  };

  // Bouton central « Frais » : ouvre Mes frais (déclarer, suivre, valider pour un N+1).
  const [fraisOpen, setFraisOpen] = useState(false);
  const handleCenterPress = () => {
    setMailMenuOpen(false);
    setFraisOpen(true);
  };

  return (
    <div className="relative flex h-dvh flex-col bg-shell">
      <MobileHeader
        title={title}
        kicker={kicker}
        onLogoClick={tab === "mails" ? () => setMailMenuOpen((o) => !o) : undefined}
        menuOpen={mailMenuOpen}
      />

      {/* Calendrier et Mails restent montés (masqués quand inactifs) : les mails se chargent dès
          l'ouverture de l'appli et le passage d'un onglet à l'autre est instantané, comme une appli native. */}
      <main className="relative flex-1 overflow-hidden">
        <div className={tab === "calendrier" ? "h-full" : "hidden"}>
          <MobileCalendrierScreen />
        </div>
        <div className={tab === "mails" ? "h-full" : "hidden"}>
          <MobileMailsScreen menuOpen={tab === "mails" && mailMenuOpen} onMenuClose={closeMailMenu} onContextChange={setMailContext} />
        </div>
        {tab === "accueil" && (
          <div className="h-full overflow-y-auto p-3 pb-20">
            <AccueilScreen
              punchedIn={punchedIn}
              onTogglePunch={() => setPunchedIn((p) => !p)}
              onNavigate={(app) => {
                if (app === "frais") setFraisOpen(true);
                else if (app === "calendrier" || app === "mails") selectTab(app);
              }}
            />
          </div>
        )}
        {tab !== "calendrier" && tab !== "mails" && tab !== "accueil" && (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-3">
            Module « {title} » — bientôt sur mobile
          </div>
        )}
      </main>

      {fraisOpen && (
        <div className="absolute inset-0 z-40 flex flex-col bg-shell">
          <MobileHeader title="Frais" kicker="NOTES DE FRAIS" />
          <div className="flex-1 overflow-y-auto pb-20">
            <FraisScreen />
          </div>
          <button
            onClick={() => setFraisOpen(false)}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white shadow-modal"
          >
            Fermer
          </button>
        </div>
      )}

      <MobileBottomNav active={tab} onSelect={selectTab} onCenterPress={handleCenterPress} />
    </div>
  );
}
