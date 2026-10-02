"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/board/calendar";

// Réglage « par défaut » (clic droit sur l'icône) mémorisé dans le navigateur ; le clic simple
// n'agit que sur la session en cours. v2 : ancien réglage unique, repris comme valeur par défaut.
const DEFAULTS_KEY = "lgef-board:calendar-coverage-defaults";
const LEGACY_KEY = "lgef-board:calendar-coverage-v2";

export type CoverageFilters = { video: boolean; photo: boolean };

function readDefaults(): CoverageFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? "null") as Partial<CoverageFilters> | null;
    return { video: saved?.video ?? false, photo: saved?.photo ?? false };
  } catch {
    return { video: false, photo: false };
  }
}

/**
 * Filtres « CouvVidéo » / « CouvPhoto » du calendrier (ordinateur et mobile). Ils affichent les
 * matchs du week-end couverts en vidéo / en photo. Chacun a un réglage par défaut (masqué tant
 * qu'on ne l'a pas changé : une trentaine de matchs par week-end encombreraient la grille) ;
 * le clic simple affiche ou masque pour la session sans toucher au défaut.
 */
export function useCoverageFilters(): [CoverageFilters, (next: CoverageFilters) => void, CoverageFilters, (kind: keyof CoverageFilters, on: boolean) => void] {
  const [defaults, setDefaults] = useState<CoverageFilters>(readDefaults);
  const [filters, setFilters] = useState<CoverageFilters>(defaults);
  const setDefault = (kind: keyof CoverageFilters, on: boolean) => {
    const next = { ...defaults, [kind]: on };
    setDefaults(next);
    setFilters((f) => ({ ...f, [kind]: on }));
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : le choix vaut pour la session
    }
  };
  return [filters, setFilters, defaults, setDefault];
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
