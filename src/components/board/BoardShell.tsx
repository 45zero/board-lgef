"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { TopBar } from "./TopBar";
import { AppRail } from "./AppRail";
import { Dock } from "./Dock";
import { ContextPanel } from "./ContextPanel";
import { BoardSettingsModal } from "./BoardSettingsModal";
import { AccueilScreen } from "./screens/AccueilScreen";
import { MailsScreen } from "./screens/MailsScreen";
import { CalendrierScreen } from "./screens/CalendrierScreen";
import { GedScreen } from "./screens/GedScreen";
import { PublicationScreen } from "./screens/PublicationScreen";
import { DriveScreen } from "./screens/DriveScreen";
import { InscriptionScreen } from "./screens/InscriptionScreen";
import { CartographieScreen } from "./screens/CartographieScreen";
import { FraisScreen } from "./screens/FraisScreen";
import { WeekendScreen } from "./screens/WeekendScreen";
import { MobileShell } from "./mobile/MobileShell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBoardPreferences } from "@/hooks/board/useBoardPreferences";
import { BOARD_APPS } from "@/lib/board/tokens";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";

export type NavLayout = "rail" | "list";
export type Theme = "light" | "dark";

/** Modules gardés en mémoire une fois ouverts (les autres n'existent pas encore). */
const KEEP_ALIVE_APPS = ["accueil", "mails", "calendrier", "ged", "audiovisuel", "drive", "inscription", "cartographie", "frais", "weekend"];
/** Préchargés en arrière-plan juste après l'ouverture du board : les plus consultés. */
const PRELOAD_APPS = ["mails", "calendrier"];

function renderScreen(id: string, props: { punchedIn: boolean; onTogglePunch: () => void; onNavigate: (app: string) => void }) {
  switch (id) {
    case "accueil":
      return <AccueilScreen punchedIn={props.punchedIn} onTogglePunch={props.onTogglePunch} onNavigate={props.onNavigate} />;
    case "mails":
      return <MailsScreen />;
    case "calendrier":
      return <CalendrierScreen />;
    case "ged":
      return <GedScreen />;
    case "audiovisuel":
      return <PublicationScreen />;
    case "drive":
      return <DriveScreen />;
    case "inscription":
      return <InscriptionScreen />;
    case "cartographie":
      return <CartographieScreen />;
    case "frais":
      return <FraisScreen />;
    case "weekend":
      return <WeekendScreen />;
    default:
      return null;
  }
}

export function BoardShell() {
  const [app, setApp] = useState("accueil");
  const [mounted, setMounted] = useState<Set<string>>(() => new Set(["accueil"]));

  // Module ouvert → monté pour de bon ; les modules les plus consultés sont préchargés dès que le
  // navigateur est libre, pour qu'ils s'affichent sans attente au premier clic.
  const selectApp = (id: string) => {
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setApp(id);
  };
  useEffect(() => {
    const preload = () => setMounted((prev) => new Set([...prev, ...PRELOAD_APPS]));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const handle = w.requestIdleCallback ? w.requestIdleCallback(preload) : window.setTimeout(preload, 1500);
    return () => {
      if (!w.requestIdleCallback) window.clearTimeout(handle);
    };
  }, []);
  const [theme, setTheme] = useState<Theme>("light");
  const [nav, setNav] = useState<NavLayout>("rail");
  const [punchedIn, setPunchedIn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useIsMobile();
  const { prefs, update, updateWidgets } = useBoardPreferences();

  const currentApp = BOARD_APPS.find((a) => a.id === app) ?? BOARD_APPS[0];

  if (isMobile === null) return null;
  if (isMobile)
    return (
      <>
        <MobileShell />
        <BackgroundTasksPanel />
      </>
    );

  const showContextPanel =
    prefs.contextPanelOpen && (app === "accueil" || app === "mails" || app === "calendrier");

  return (
    <div data-theme={theme} className="min-h-screen bg-shell relative overflow-hidden">
      <div className="relative flex h-screen flex-col">
        <TopBar
          currentApp={currentApp}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          onOpenSettings={() => setSettingsOpen((o) => !o)}
        />

        <div className="flex flex-1 overflow-hidden px-4 pb-4 gap-4">
          {prefs.navStyle === "rail" && (
            <AppRail nav={nav} activeApp={app} onSelectApp={selectApp} onToggleNav={setNav} />
          )}

          {/* Les modules déjà ouverts restent montés (masqués quand inactifs) : y revenir est
              instantané, avec leurs données et leur position de défilement, comme une appli native. */}
          <main className="relative flex-1 overflow-hidden rounded-panel">
            {KEEP_ALIVE_APPS.filter((id) => mounted.has(id)).map((id) => (
              <div key={id} className={app === id ? "h-full overflow-y-auto" : "hidden"}>
                {renderScreen(id, { punchedIn, onTogglePunch: () => setPunchedIn((p) => !p), onNavigate: selectApp })}
              </div>
            ))}
            {!KEEP_ALIVE_APPS.includes(app) && (
              <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card/60 text-ink-3">
                Module « {currentApp.label} » — à venir
              </div>
            )}
          </main>

          {showContextPanel && (
            <ContextPanel
              widgets={prefs.contextPanelWidgets}
              onClose={() => update({ contextPanelOpen: false })}
            />
          )}
          {/* Panneau refermé : languette pour le rouvrir (sinon il n'était récupérable que dans les paramètres). */}
          {!prefs.contextPanelOpen && (app === "accueil" || app === "mails" || app === "calendrier") && (
            <button
              type="button"
              onClick={() => update({ contextPanelOpen: true })}
              title="Afficher le récapitulatif"
              aria-label="Afficher le récapitulatif"
              className="flex w-7 shrink-0 items-center justify-center self-start rounded-l-btn rounded-r-btn border border-line bg-card/80 py-6 text-ink-3 shadow-bar hover:bg-hover hover:text-ink"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        {prefs.navStyle === "dock" && (
          <Dock
            activeApp={app}
            onSelectApp={selectApp}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          />
        )}
      </div>

      <BackgroundTasksPanel />

      {settingsOpen && (
        <BoardSettingsModal
          prefs={prefs}
          onUpdate={update}
          onUpdateWidgets={updateWidgets}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
