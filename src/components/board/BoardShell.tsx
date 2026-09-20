"use client";

import { useState } from "react";
import { TopBar } from "./TopBar";
import { AppRail } from "./AppRail";
import { Dock } from "./Dock";
import { ContextPanel } from "./ContextPanel";
import { AccueilScreen } from "./screens/AccueilScreen";
import { MailsScreen } from "./screens/MailsScreen";
import { CalendrierScreen } from "./screens/CalendrierScreen";
import { GedScreen } from "./screens/GedScreen";
import { MobileShell } from "./mobile/MobileShell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { BOARD_APPS } from "@/lib/board/tokens";

export type NavLayout = "rail" | "list";
export type Theme = "light" | "dark";

export function BoardShell() {
  const [app, setApp] = useState("accueil");
  const [theme, setTheme] = useState<Theme>("light");
  const [nav, setNav] = useState<NavLayout>("rail");
  const [punchedIn, setPunchedIn] = useState(true);
  const isMobile = useIsMobile();

  const currentApp = BOARD_APPS.find((a) => a.id === app) ?? BOARD_APPS[0];

  if (isMobile === null) return null;
  if (isMobile) return <MobileShell />;

  return (
    <div data-theme={theme} className="min-h-screen bg-shell relative overflow-hidden">
      <div className="relative flex h-screen flex-col">
        <TopBar
          currentApp={currentApp}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        />

        <div className="flex flex-1 overflow-hidden px-4 pb-4 gap-4">
          <AppRail nav={nav} activeApp={app} onSelectApp={setApp} onToggleNav={setNav} />

          <main className="flex-1 overflow-y-auto rounded-panel">
            {app === "accueil" ? (
              <AccueilScreen punchedIn={punchedIn} onTogglePunch={() => setPunchedIn((p) => !p)} />
            ) : app === "mails" ? (
              <MailsScreen />
            ) : app === "calendrier" ? (
              <CalendrierScreen />
            ) : app === "ged" ? (
              <GedScreen />
            ) : (
              <div className="flex h-full items-center justify-center rounded-panel border border-line bg-card/60 text-ink-3">
                Module « {currentApp.label} » — à venir
              </div>
            )}
          </main>

          {(app === "accueil" || app === "mails" || app === "calendrier") && <ContextPanel />}
        </div>

        <Dock activeApp={app} onSelectApp={setApp} />
      </div>
    </div>
  );
}
