"use client";

import { useEffect, useState } from "react";

export type NavStyle = "rail" | "dock";

export interface ContextPanelWidgets {
  today: boolean;
  trello: boolean;
  activity: boolean;
  migration: boolean;
}

export interface BoardPreferences {
  navStyle: NavStyle;
  contextPanelOpen: boolean;
  contextPanelWidgets: ContextPanelWidgets;
}

const STORAGE_KEY = "board-lgef:preferences";

const DEFAULTS: BoardPreferences = {
  navStyle: "rail",
  contextPanelOpen: true,
  contextPanelWidgets: { today: true, trello: false, activity: true, migration: true },
};

/** Préférences d'affichage personnelles (navigation, panneau récapitulatif) — persistées en local, propres à cet appareil. */
export function useBoardPreferences() {
  const [prefs, setPrefs] = useState<BoardPreferences>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage on mount, no async fetch involved
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {
      // localStorage indisponible (navigation privée...) — on reste sur les valeurs par défaut
    }
  }, []);

  const update = (partial: Partial<BoardPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...partial };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // sans conséquence — la préférence vivra juste pour la session en cours
      }
      return next;
    });
  };

  const updateWidgets = (partial: Partial<ContextPanelWidgets>) => {
    update({ contextPanelWidgets: { ...prefs.contextPanelWidgets, ...partial } });
  };

  return { prefs, update, updateWidgets };
}
