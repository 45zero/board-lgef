"use client";

import { useCanPublish } from "@/hooks/board/useCanPublish";
import { useCallback, useEffect, useState } from "react";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { MobileBottomNav, type MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { MobileCalendrierScreen } from "@/components/board/mobile/screens/MobileCalendrierScreen";
import { MobileMailsScreen } from "@/components/board/mobile/screens/MobileMailsScreen";
import { FraisScreen } from "@/components/board/screens/FraisScreen";
import { AccueilScreen } from "@/components/board/screens/AccueilScreen";
import { WeekendScreen } from "@/components/board/screens/WeekendScreen";
import { MobileSettingsSheet, useCenterAction } from "@/components/board/mobile/MobileSettingsSheet";
import { readAppParam } from "@/lib/board/deepLink";
import { SocialCapture } from "@/components/board/publication/SocialCapture";
import { Composer } from "@/components/board/screens/PublicationScreen";
import type { MediaPublication } from "@/lib/board/mediaPublications";

const TITLES: Record<MobileTab, { title: string; kicker: string }> = {
  calendrier: { title: "Calendrier", kicker: "EVENEMENTS" },
  accueil: { title: "Dashboard", kicker: "ESPACE DE TRAVAIL" },
  mails: { title: "Mails", kicker: "MESSAGERIE" },
  weekend: { title: "Week-end", kicker: "MATCHS & COUVERTURE" },
};

/** Coque mobile — même app Next.js, bascule vers cette coque sous ~768px (voir useIsMobile). */
export function MobileShell() {
  // Lien direct depuis un e-mail (/?app=weekend, /?app=frais…).
  const [linkedApp] = useState(readAppParam);
  const [tab, setTab] = useState<MobileTab>(() =>
    linkedApp === "accueil" || linkedApp === "mails" || linkedApp === "weekend" ? linkedApp : "calendrier"
  );
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

  // Bouton central, réglable dans Paramètres : « Frais » ouvre Mes frais (photo d'un justificatif,
  // déclaration…) ; « Publication réseaux » ouvre la caméra puis le centre de publication.
  const [centerPref, setCenter] = useCenterAction();
  const canPublish = !!useCanPublish();
  // Publication réseaux réservée aux personnes habilitées : sinon, bouton Frais.
  const center = centerPref === "social" && !canPublish ? "frais" : centerPref;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fraisOpen, setFraisOpen] = useState(linkedApp === "frais");
  const [socialOpen, setSocialOpen] = useState(false);
  // Publication dont les médias ont fini de s'envoyer en arrière-plan : choix des réseaux.
  const [composerPub, setComposerPub] = useState<MediaPublication | null>(null);
  // Appli mobile : la page elle-même ne défile ni ne rebondit jamais (seules les listes internes
  // défilent). Sans ce verrou, Chrome / Samsung Internet / Safari laissent un léger défilement de
  // la page entière (hauteur d'écran arrondie, effet élastique).
  useEffect(() => {
    document.documentElement.classList.add("mobile-locked");
    return () => document.documentElement.classList.remove("mobile-locked");
  }, []);

  const handleCenterPress = () => {
    setMailMenuOpen(false);
    if (center === "social") setSocialOpen(true);
    else setFraisOpen(true);
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-shell">
      <MobileHeader
        title={title}
        kicker={kicker}
        onLogoClick={tab === "mails" ? () => setMailMenuOpen((o) => !o) : undefined}
        menuOpen={mailMenuOpen}
        onSettings={() => setSettingsOpen(true)}
        app={tab}
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
          <div className="h-full px-3 pt-3">
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
        {tab === "weekend" && (
          <div className="h-full overflow-y-auto pb-20">
            <WeekendScreen />
          </div>
        )}
      </main>

      {fraisOpen && (
        <div className="absolute inset-0 z-40 flex flex-col bg-shell">
          <MobileHeader title="Frais" kicker="NOTES DE FRAIS" app="frais" />
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

      {socialOpen && <SocialCapture onClose={() => setSocialOpen(false)} onReady={setComposerPub} />}
      {composerPub && <Composer pub={composerPub} onClose={() => setComposerPub(null)} onDone={() => setComposerPub(null)} />}
      {settingsOpen && (
        <MobileSettingsSheet
          canPublish={canPublish}
          value={center}
          onChange={(a) => {
            setCenter(a);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <MobileBottomNav active={tab} onSelect={selectTab} onCenterPress={handleCenterPress} center={center} />
    </div>
  );
}
