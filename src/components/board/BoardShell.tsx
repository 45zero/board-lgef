"use client";

import { DiscussionsBubble } from "@/components/board/discussions/DiscussionsBubble";
import { useEffect, useRef, useState } from "react";
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
import { TeamScreen } from "./screens/TeamScreen";
import { EffectifScreen } from "./screens/EffectifScreen";
import { TransferScreen } from "./screens/TransferScreen";
import { FiefScreen } from "./screens/FiefScreen";
import { TournoisScreen } from "./screens/TournoisScreen";
import { MobileShell } from "./mobile/MobileShell";
import { useLive } from "./live/LiveProvider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBoardPreferences } from "@/hooks/board/useBoardPreferences";
import { BOARD_APPS } from "@/lib/board/tokens";
import { BackgroundTasksPanel } from "./BackgroundTasksPanel";
import { InstallNotificationsPrompt } from "./InstallNotificationsPrompt";
import { ProfileCompletionPrompt } from "./ProfileCompletionPrompt";
import { VersionWatcher } from "./VersionWatcher";
import { ModuleAccessModal } from "./modules/ModuleAccessModal";
import { canShowModule, useVisibleModules } from "@/hooks/board/useVisibleModules";
import { useUserRole } from "@/hooks/board/useUserRole";
import { clearAppParam, readAppParam } from "@/lib/board/deepLink";

export type NavLayout = "rail" | "list";
export type Theme = "light" | "dark";

/** Modules gardés en mémoire une fois ouverts (les autres n'existent pas encore). */
const KEEP_ALIVE_APPS = ["accueil", "trello", "effectif", "mails", "calendrier", "ged", "audiovisuel", "drive", "transfer", "inscription", "cartographie", "frais", "weekend", "fief", "tournois"];
/** Préchargés en arrière-plan juste après l'ouverture du board : les plus consultés. */
const PRELOAD_APPS = ["mails", "calendrier"];
/**
 * Modules restés montés sans mise à jour en direct (Google Drive, Transfert, FIEF…) : après un retour
 * d'absence ou une reconnexion, ils sont rechargés à leur prochain affichage (remontés, données
 * fraîches). Les autres se mettent à jour eux-mêmes (useLiveRefresh) et gardent leur état.
 */
const RELOAD_ON_RETURN_APPS = ["drive", "ged", "cartographie", "tournois", "transfer", "fief"];

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
    case "transfer":
      return <TransferScreen />;
    case "inscription":
      return <InscriptionScreen />;
    case "cartographie":
      return <CartographieScreen />;
    case "frais":
      return <FraisScreen />;
    case "effectif":
      return <EffectifScreen />;
    case "weekend":
      return <WeekendScreen />;
    case "fief":
      return <FiefScreen />;
    case "tournois":
      return <TournoisScreen />;
    case "trello":
      return <TeamScreen />;
    default:
      return null;
  }
}

export function BoardShell() {
  // Lien direct depuis un e-mail (/?app=frais…) : module ouvert d'emblée.
  const [selectedApp, setApp] = useState(() => readAppParam() ?? "accueil");
  // Module masqué (règle d'accès modifiée pendant qu'il était ouvert) : retour à l'accueil.
  const visible = useVisibleModules();
  const app = canShowModule(visible, selectedApp) ? selectedApp : "accueil";
  // Retour après une absence : les modules sans direct, masqués, sont à recharger ; celui affiché l'est tout de suite.
  const appRef = useRef(app);
  useEffect(() => {
    appRef.current = app;
  });
  const role = useUserRole();
  const canManageAccess = role.isAdmin || role.isSuperUser;
  const [accessOpen, setAccessOpen] = useState(false);
  const [mounted, setMounted] = useState<Set<string>>(() => new Set(["accueil", selectedApp]));

  // Module ouvert → monté pour de bon ; les modules les plus consultés sont préchargés dès que le
  // navigateur est libre, pour qu'ils s'affichent sans attente au premier clic.
  // Génération par module : la changer remonte le module (rechargement complet de ses données).
  const [generation, setGeneration] = useState<Record<string, number>>({});
  const [staleApps, setStaleApps] = useState<Set<string>>(() => new Set());
  const { resumes } = useLive();
  const selectApp = (id: string) => {
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (staleApps.has(id)) {
      setStaleApps((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setGeneration((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 }));
    }
    setApp(id);
  };
  useEffect(() => {
    if (resumes === 0) return;
    const active = appRef.current;
    queueMicrotask(() => {
      setStaleApps(new Set(RELOAD_ON_RETURN_APPS.filter((id) => id !== active)));
      if (RELOAD_ON_RETURN_APPS.includes(active)) setGeneration((g) => ({ ...g, [active]: (g[active] ?? 0) + 1 }));
    });
  }, [resumes]);
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
  // ?app= retiré de l'adresse une fois la coque (ordinateur ou mobile) affichée et le lien lu.
  useEffect(() => {
    if (isMobile !== null) clearAppParam();
  }, [isMobile]);
  const { prefs, update, updateWidgets } = useBoardPreferences();

  const currentApp = BOARD_APPS.find((a) => a.id === app) ?? BOARD_APPS[0];

  if (isMobile === null) return null;
  if (isMobile)
    return (
      <>
        <MobileShell />
        <DiscussionsBubble mobile />
        <BackgroundTasksPanel mobile />
        <InstallNotificationsPrompt mobile />
        <ProfileCompletionPrompt />
        <VersionWatcher />
      </>
    );

  return (
    <div data-theme={theme} className="min-h-screen bg-shell relative overflow-hidden">
      {/* Rail : collé aux bords de la fenêtre, il monte jusqu'en haut (logo de la Ligue en tête), la barre du
          haut (collée au rail et au bord) et le contenu à sa droite. Dock : barre du haut pleine largeur, comme avant. */}
      <div className={`relative flex h-screen ${prefs.navStyle === "rail" ? "" : "flex-col"}`}>
        {prefs.navStyle === "rail" && <AppRail nav={nav} activeApp={app} onSelectApp={selectApp} onToggleNav={setNav} />}
        <div className={prefs.navStyle === "rail" ? "flex min-w-0 flex-1 flex-col gap-4" : "contents"}>
        <TopBar
          brand={prefs.navStyle !== "rail"}
          currentApp={currentApp}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          onOpenSettings={() => setSettingsOpen((o) => !o)}
          onOpenModuleAccess={canManageAccess && app !== "accueil" ? () => setAccessOpen(true) : undefined}
          onNavigate={selectApp}
        />

        <div className="flex flex-1 gap-4 overflow-hidden px-4 pb-4">

          {/* Les modules déjà ouverts restent montés (masqués quand inactifs) : y revenir est
              instantané, avec leurs données et leur position de défilement, comme une appli native. */}
          <main className="relative flex-1 overflow-hidden rounded-panel">
            {KEEP_ALIVE_APPS.filter((id) => mounted.has(id) && canShowModule(visible, id)).map((id) => (
              <div key={`${id}:${generation[id] ?? 0}`} className={app === id ? "h-full overflow-y-auto" : "hidden"}>
                {renderScreen(id, { punchedIn, onTogglePunch: () => setPunchedIn((p) => !p), onNavigate: selectApp })}
              </div>
            ))}
            {!KEEP_ALIVE_APPS.includes(app) && (
              <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card/60 text-ink-3">
                Module « {currentApp.label} » — à venir
              </div>
            )}
            <DiscussionsBubble />
          </main>

          {/* Récapitulatif disponible sur tous les onglets ; ouvert ou refermé, l'état est commun. */}
          {prefs.contextPanelOpen && (
            <ContextPanel
              widgets={prefs.contextPanelWidgets}
              onClose={() => update({ contextPanelOpen: false })}
            />
          )}
          {/* Panneau refermé : languette pour le rouvrir (sinon il n'était récupérable que dans les paramètres). */}
          {!prefs.contextPanelOpen && (
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
      <InstallNotificationsPrompt />
      <ProfileCompletionPrompt />
      <VersionWatcher />

      {accessOpen && <ModuleAccessModal initialModuleId={app} onClose={() => setAccessOpen(false)} />}

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
