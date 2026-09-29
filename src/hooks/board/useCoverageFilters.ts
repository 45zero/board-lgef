"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/board/calendar";

const KEY = "lgef-board:calendar-coverage";

export type CoverageFilters = { video: boolean; photo: boolean };

/**
 * Filtres « CouvVidéo » / « CouvPhoto » du calendrier (ordinateur et mobile), mémorisés dans le
 * navigateur. CouvPhoto est désactivé par défaut : les matchs du réseau photo (une trentaine par
 * week-end) encombreraient la grille.
 */
export function useCoverageFilters(): [CoverageFilters, (next: CoverageFilters) => void] {
  const [filters, setFilters] = useState<CoverageFilters>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CoverageFilters> | null;
      return { video: saved?.video ?? true, photo: saved?.photo ?? false };
    } catch {
      return { video: true, photo: false };
    }
  });
  const set = (next: CoverageFilters) => {
    setFilters(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [filters, set];
}

/**
 * Un événement couvert en vidéo et/ou en photo reste affiché si l'une de ses couvertures est
 * cochée ; un événement sans couverture n'est jamais filtré.
 */
export function passesCoverageFilters(e: CalendarEvent, f: CoverageFilters) {
  const video = e.requiresCoverage;
  const photo = !!e.photoCoverage;
  if (!video && !photo) return true;
  return (video && f.video) || (photo && f.photo);
}
