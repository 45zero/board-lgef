"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/board/calendar";

// v2 : les filtres ne portent plus que sur les matchs du week-end (anciens réglages ignorés).
const KEY = "lgef-board:calendar-coverage-v2";

export type CoverageFilters = { video: boolean; photo: boolean };

/**
 * Filtres « CouvVidéo » / « CouvPhoto » du calendrier (ordinateur et mobile), mémorisés dans le
 * navigateur. Ils affichent les matchs du week-end couverts en vidéo / en photo ; désactivés par
 * défaut : une trentaine de matchs par week-end encombreraient la grille.
 */
export function useCoverageFilters(): [CoverageFilters, (next: CoverageFilters) => void] {
  const [filters, setFilters] = useState<CoverageFilters>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<CoverageFilters> | null;
      return { video: saved?.video ?? false, photo: saved?.photo ?? false };
    } catch {
      return { video: false, photo: false };
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
 * Seuls les matchs du week-end sont filtrés : un match couvert en vidéo et/ou en photo est affiché
 * si l'une de ses couvertures est cochée ; un match sans couverture n'est pas affiché (il reste dans
 * le module Week-end). Les autres événements, et les matchs où je suis sollicité, restent toujours visibles.
 */
export function passesCoverageFilters(e: CalendarEvent, f: CoverageFilters) {
  if (!e.weekendMatch || e.solicited) return true;
  const video = e.requiresCoverage && e.coverage !== "no";
  const photo = !!e.photoCoverage;
  return (video && f.video) || (photo && f.photo);
}
