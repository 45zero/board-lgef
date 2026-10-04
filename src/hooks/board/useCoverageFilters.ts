"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/board/calendar";
import { useCalendarDefaults } from "@/hooks/board/useCalendarDefaults";

export type CoverageFilters = { video: boolean; photo: boolean };

/**
 * Filtres « CouvVidéo » / « CouvPhoto » du calendrier (ordinateur et mobile). Ils affichent les
 * matchs du week-end couverts en vidéo / en photo. Le réglage par défaut (clic droit) est celui du
 * compte (useCalendarDefaults, repris sur le mobile) ; le clic simple affiche ou masque pour la
 * session sans toucher au défaut.
 */
export function useCoverageFilters(): [CoverageFilters, (next: CoverageFilters) => void, CoverageFilters, (kind: keyof CoverageFilters, on: boolean) => void] {
  const [defaults, setCalendarDefault] = useCalendarDefaults();
  const [session, setSession] = useState<Partial<CoverageFilters>>({});
  const filters = { video: session.video ?? defaults.video, photo: session.photo ?? defaults.photo };
  const setDefault = (kind: keyof CoverageFilters, on: boolean) => {
    setCalendarDefault(kind, on);
    setSession((s) => ({ ...s, [kind]: on }));
  };
  return [filters, setSession, { video: defaults.video, photo: defaults.photo }, setDefault];
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
