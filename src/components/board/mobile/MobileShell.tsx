"use client";

import { useCanPublish } from "@/hooks/board/useCanPublish";
import { useCallback, useEffect, useState } from "react";
import { MobileHeader } from "@/components/board/mobile/MobileHeader";
import { MobileBottomNav, useNavOrder, useStartTab, type MobileTab } from "@/components/board/mobile/MobileBottomNav";
import { MobileCalendrierScreen } from "@/components/board/mobile/screens/MobileCalendrierScreen";
import { MobileMailsScreen } from "@/components/board/mobile/screens/MobileMailsScreen";
import { FraisScreen } from "@/components/board/screens/FraisScreen";
import { AccueilScreen } from "@/components/board/screens/AccueilScreen";
import { WeekendScreen } from "@/components/board/screens/WeekendScreen";
import { TeamScreen } from "@/components/board/screens/TeamScreen";
import { TransferScreen } from "@/components/board/screens/TransferScreen";
import { MobileModulesMenu } from "@/components/board/mobile/MobileModulesMenu";
import { MobileSettingsSheet, useCenterAction } from "@/components/board/mobile/MobileSettingsSheet";
import { readAppParam } from "@/lib/board/deepLink";
import { SocialCapture } from "@/components/board/publication/SocialCapture";
import { Composer, PublicationScreen } from "@/components/board/screens/PublicationScreen";
import { ChevronLeft, X } from "lucide-react";
import type { MediaPublication } from "@/lib/board/mediaPublications";

const TITLES: Record<MobileTab, { title: string; kicker: string }> = {
  calendrier: { title: "Calendrier", kicker: "EVENEMENTS" },
  accueil: { title: "Dashboard", kicker: "ESPACE DE TRAVAIL" },
  mails: { title: "Mails", kicker: "MESSAGERIE" },
  weekend: { title: "Week-end", kicker: "MATCHS & COUVERTURE" },
  team: { title: "Espace Team", kicker: "CARTES & TABLEAUX" },
  transfer: { title: "Transferts", kicker: "LGEF TRANSFER" },
};

/** Lien direct (/?app=…) → écran mobile. */
const LINKED_TABS: Record<string, MobileTab> = { accueil: "accueil", mails: "mails", weekend: "weekend", trello: "team", transfer: "transfer" };

/** Coque mobile — même app Next.js, bascule vers cette coque sous ~768px (voir useIsMobile). */
export function MobileShell() {
  // Lien direct depuis un e-mail (/?app=weekend, /?app=frais…).
  const [linkedApp] = useState(readAppParam);
  // Page d'ouverture choisie dans Paramètres, sauf lien direct.
  const [startTab, setStartTab] = useStartTab();
  const [tab, setTab] = useState<MobileTab>(() => (linkedApp && LINKED_TABS[linkedApp]) || startTab);
  const [mailMenuOpen, setMailMenuOpen] = useState(false);
  // Menu des modules (logo de l'en-tête, hors Mails qui y garde ses dossiers) : Week-end, Transferts…
  const [modulesOpen, setModulesOpen] = useState(false);
  const [punchedIn, setPunchedIn] = useState(true);
  const [mailContext, setMailContext] = useState<string | null>(null);
  const closeMailMenu = useCallback(() => setMailMenuOpen(false), []);

  const { title } = TITLES[tab];
  const kicker = tab === "mails" && mailContext ? mailContext : TITLES[tab].kicker;

  const selectTab = (next: MobileTab) => {
    setMailMenuOpen(false);
    setModulesOpen(false);
    setTab(next);
  };

  // Bouton central, réglable dans Paramètres : « Frais » ouvre Mes frais (photo d'un justificatif,
  // déclaration…) ; « Publication réseaux » ouvre la caméra puis le centre de publication.
  const [centerPref, setCenter] = useCenterAction();
  const [navOrder, setNavOrder] = useNavOrder();
  const canPublish = !!useCanPublish();
  // Publication réseaux réservée aux personnes habilitées : sinon, bouton Frais.
  const center = centerPref === "social" && !canPublish ? "frais" : centerPref;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fraisOpen, setFraisOpen] = useState(linkedApp === "frais");
  const [socialOpen, setSocialOpen] = useState(false);
  // Publication dont les médias ont fini de s'envoyer en arrière-plan : choix des réseaux.
  const [composerPub, setComposerPub] = useState<MediaPublication | null>(null);
  // Centre de publication, ouvert depuis l'écran du bouton central.
  const [centerOpen, setCenterOpen] = useState(linkedApp === "audiovisuel");
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
        onLogoClick={tab === "mails" ? () => setMailMenuOpen((o) => !o) : () => setModulesOpen((o) => !o)}
        menuOpen={tab === "mails" ? mailMenuOpen : modulesOpen}
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
        {tab === "team" && (
          <div className="h-full">
            <TeamScreen mobile />
          </div>
        )}
        {tab === "transfer" && (
          <div className="h-full overflow-y-auto px-3 pb-20 pt-3">
            <TransferScreen />
          </div>
        )}
        {modulesOpen && tab !== "mails" && (
          <MobileModulesMenu
            active={tab}
            canPublish={canPublish}
            onClose={() => setModulesOpen(false)}
            onSelect={(target) => {
              setModulesOpen(false);
              if (target === "frais") setFraisOpen(true);
              else if (target === "audiovisuel") setCenterOpen(true);
              else selectTab(target);
            }}
          />
        )}
      </main>

      {fraisOpen && (
        <div className="absolute inset-0 z-40 bg-shell">
          <FraisScreen mobile={{ onBack: () => setFraisOpen(false) }} />
        </div>
      )}

      {socialOpen && (
        <SocialCapture
          onClose={() => setSocialOpen(false)}
          onReady={setComposerPub}
          onOpenCenter={() => {
            setSocialOpen(false);
            setCenterOpen(true);
          }}
        />
      )}
      {/* Sous les fenêtres du centre (compositeur, z-60) et au-dessus de la barre du bas. */}
      {centerOpen && (
        <div className="fixed inset-0 z-[55] flex flex-col bg-shell">
          <div className="flex shrink-0 items-center gap-2 bg-navy px-3 pb-3 text-white" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
            <button
              onClick={() => {
                setCenterOpen(false);
                setSocialOpen(true);
              }}
              className="rounded-full p-1.5 hover:bg-white/10"
              aria-label="Retour"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">Publication réseaux</div>
              <div className="text-sm font-extrabold">Centre de publication</div>
            </div>
            <button onClick={() => setCenterOpen(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Fermer">
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <PublicationScreen />
          </div>
        </div>
      )}
      {composerPub && <Composer pub={composerPub} onClose={() => setComposerPub(null)} onDone={() => setComposerPub(null)} />}
      {settingsOpen && (
        <MobileSettingsSheet
          canPublish={canPublish}
          navOrder={navOrder}
          onNavOrderChange={setNavOrder}
          startTab={startTab}
          onStartTabChange={setStartTab}
          value={center}
          onChange={(a) => {
            setCenter(a);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <MobileBottomNav
        active={tab}
        onSelect={selectTab}
        onCenterPress={handleCenterPress}
        // Appui long : Frais ↔ Publication réseaux (seulement pour qui peut publier).
        onCenterLongPress={canPublish && center !== "off" ? () => setCenter(center === "frais" ? "social" : "frais") : undefined}
        center={center}
        order={navOrder}
      />
    </div>
  );
}
